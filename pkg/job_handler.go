package main

import (
	"time"

	"github.com/grafana/grafana_plugin_model/go/datasource"
	hclog "github.com/hashicorp/go-hclog"
	"github.com/signalfx/signalfx-go/idtool"
	"github.com/signalfx/signalfx-go/signalflow"
	"github.com/signalfx/signalfx-go/signalflow/messages"
)

type SignalflowClient interface {
	Execute(req *signalflow.ExecuteRequest) (*signalflow.Computation, error)
}

type SignalflowComputation interface {
	Data() <-chan *messages.DataMessage
	MaxDelay() time.Duration
	Resolution() time.Duration
	TSIDMetadata(tsid idtool.ID) *messages.MetadataProperties
	IsFinished() bool
	Done() <-chan struct{}
	Err() error
	Stop() error
}

type SignalFxJob interface {
	stop()
	Program() string
	isActive(time time.Time) bool
	reuse(target *Target) <-chan []*datasource.TimeSeries
}

type SignalFxJobHandler struct {
	logger      hclog.Logger
	client      SignalflowClient
	computation SignalflowComputation
	batchOut    chan []*datasource.TimeSeries
	program     string
	interval    time.Duration
	startTime   time.Time
	stopTime    time.Time
	cutoffTime  time.Time
	unbounded   bool
	lastUsed    time.Time
	Points      map[int64]([]*datasource.Point)
	Meta        map[string]interface{}
}

const streamingThresholdTimeout = 2 * time.Minute
const maxDatapointsToKeepBeforeTimerange = 1
const inactiveJobTimeout = 6 * time.Minute

func (t *SignalFxJobHandler) start(target *Target) (<-chan []*datasource.TimeSeries, error) {
	t.batchOut = make(chan []*datasource.TimeSeries, 1)
	t.initialize(target)
	comp, err := t.execute()
	if err != nil {
		t.logger.Error("Could not execute request", "error", err)
		return nil, err
	}
	t.computation = comp

	go t.readDataMessages()
	t.updateLastUsed()
	return t.batchOut, nil
}

func (t *SignalFxJobHandler) initialize(target *Target) {
	t.Points = make(map[int64]([]*datasource.Point))
	t.program = target.Program
	t.initializeTimeRange(target)
	t.interval = target.Interval
	t.unbounded = target.StopTime.After(time.Now().Add(-streamingThresholdTimeout))
}

func (t *SignalFxJobHandler) initializeTimeRange(target *Target) {
	t.startTime = target.StartTime
	t.stopTime = target.StopTime
	t.cutoffTime = t.stopTime
	now := time.Now()
	if t.stopTime.After(now) {
		t.cutoffTime = now
	}
}

func min(x, y int64) int64 {
	if x > y {
		return y
	}
	return x
}

func (t *SignalFxJobHandler) execute() (*signalflow.Computation, error) {
	request := &signalflow.ExecuteRequest{
		Program: t.program,
		Start:   t.startTime,
	}
	if t.interval > 0 {
		request.Resolution = t.interval
	}
	if !t.unbounded {
		request.Stop = t.stopTime
		request.Immediate = true
	}
	t.logger.Debug("Starting job", "program", t.program)
	return t.client.Execute(request)
}

func (t *SignalFxJobHandler) reuse(target *Target) <-chan []*datasource.TimeSeries {
	// Re-use this handler only if it has already processed the initial request
	// so that enough data is collected in the buffer and we can return it immediately
	if t.isJobReusable(target) && t.batchOut == nil {
		t.initializeTimeRange(target)
		out := make(chan []*datasource.TimeSeries, 1)
		t.flushData(out)
		t.updateLastUsed()
		return out
	}
	return nil
}

func (t *SignalFxJobHandler) isJobReusable(target *Target) bool {
	return t.program == target.Program &&
		t.interval == target.Interval &&
		!t.startTime.After(target.StartTime) &&
		((t.computation != nil && !t.computation.IsFinished() && t.unbounded) ||
			!t.stopTime.Before(target.StopTime))
}

func (t *SignalFxJobHandler) updateLastUsed() {
	t.lastUsed = time.Now()
}

func (t *SignalFxJobHandler) readDataMessages() {
	for {
		select {
		// This channel receives when there is no more data
		case <-t.computation.Done():
			t.flushData(t.batchOut)
			t.stop()
			if err := t.computation.Err(); err != nil {
				t.logger.Error("SignalFlow computation failed", "error", err)
			}
			return
		case dm := <-t.computation.Data():
			if t.handleDataMessage(dm) {
				t.flushData(t.batchOut)
			}
		}
	}
}

func (t *SignalFxJobHandler) handleDataMessage(m *messages.DataMessage) bool {
	timestamp := time.Unix(0, int64(m.TimestampMillis)*int64(time.Millisecond))
	for _, pl := range m.Payloads {
		tsid := int64(pl.TSID)
		value := pl.Value()
		if (t.Points[tsid]) == nil {
			t.Points[tsid] = make([]*datasource.Point, 0)
		}
		t.Points[tsid] = append(t.Points[tsid], &datasource.Point{
			Timestamp: timestamp.UnixNano() / int64(time.Millisecond),
			Value:     toFloat64(value),
		})
	}
	resolution := t.computation.Resolution()
	if resolution > 0 {
		maxDelay := t.computation.MaxDelay()
		// Estimate the timestamp of the last datapoint already available in the system
		nextEstimatedTimestamp := timestamp.Add(2*resolution - 1).Add(maxDelay).Truncate(resolution)
		roundedCutoffTime := t.cutoffTime.Truncate(resolution)
		return nextEstimatedTimestamp.After(roundedCutoffTime)
	}
	return false
}

func toFloat64(value interface{}) float64 {
	switch i := value.(type) {
	case float64:
		return i
	case float32:
		return float64(i)
	case int64:
		return float64(i)
	default:
		return 0.0
	}
}

func (t *SignalFxJobHandler) stop() {
	t.logger.Debug("Stopping job", "program", t.program)
	t.computation.Stop()
}

func (t *SignalFxJobHandler) flushData(out chan []*datasource.TimeSeries) {
	t.batchOut = nil
	if out != nil {
		t.trimDatapoints()
		series := t.convertToTimeseries()
		out <- series
	}
}

func (t *SignalFxJobHandler) convertToTimeseries() []*datasource.TimeSeries {
	series := make([]*datasource.TimeSeries, 0)
	for id, points := range t.Points {
		s := &datasource.TimeSeries{Name: t.getTimeSeriesName(idtool.ID(id)), Points: points}
		series = append(series, s)
	}
	return series
}

func (t *SignalFxJobHandler) getTimeSeriesName(tsid idtool.ID) string {
	if t.computation != nil {
		meta := t.computation.TSIDMetadata(tsid)
		if meta != nil {
			if meta.OriginatingMetric != "" {
				return meta.OriginatingMetric
			}
			return meta.Metric
		}
	}
	return "series_name"
}

func (t *SignalFxJobHandler) trimDatapoints() {
	trimTimestamp := t.startTime.Add(-time.Duration(maxDatapointsToKeepBeforeTimerange * int64(t.computation.Resolution())))
	for tsid, ss := range t.Points {
		for len(ss) > 0 && trimTimestamp.After(time.Unix(0, ss[0].Timestamp*int64(time.Millisecond))) {
			ss = ss[1:]
		}
		t.Points[tsid] = ss
	}
}

func (t *SignalFxJobHandler) isActive(now time.Time) bool {
	return now.Before(t.lastUsed.Add(inactiveJobTimeout))
}

func (t *SignalFxJobHandler) Program() string {
	return t.program
}
