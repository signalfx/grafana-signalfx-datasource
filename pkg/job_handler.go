package main

import (
	"fmt"
	"log"
	"math"
	"strconv"
	"time"

	"github.com/grafana/grafana_plugin_model/go/datasource"
	hclog "github.com/hashicorp/go-hclog"
	"github.com/signalfx/signalfx-go/signalflow"
)

type SignalFxJobHandler struct {
	logger     hclog.Logger
	client     *signalflow.Client
	channel    *signalflow.Channel
	batchOut   chan []*datasource.TimeSeries
	program    string
	maxDelay   int64
	intervalMs int64
	resolution int64
	startTime  int64
	stopTime   int64
	cutoffTime int64
	unbounded  bool
	running    bool
	lastUsed   time.Time
	Points     map[int64]([]*datasource.Point)
	Meta       map[string]interface{}
}

const streamingThresholdMinutes = 2
const maxDatapointsToKeepBeforeTimerange = 1
const inactiveJobMinutes int64 = 6

func (t *SignalFxJobHandler) start(target *Target) (chan []*datasource.TimeSeries, error) {
	// if t.running != nil {
	// 	return nil, Errors.new("Handler already running")
	// }
	t.batchOut = make(chan []*datasource.TimeSeries, 1)
	t.initialize(target)
	ch, err := t.execute()
	if err != nil {
		t.logger.Error("Could not execute request", "error", err)
		return nil, err
	}
	t.channel = ch
	t.running = true
	go t.readMessages()
	t.updateLastUsed()
	return t.batchOut, nil
}

func (t *SignalFxJobHandler) initialize(target *Target) {
	t.Points = make(map[int64]([]*datasource.Point))
	t.program = target.Program
	t.initializeTimeRange(target)
	t.intervalMs = target.IntervalMs
	t.resolution = 0
	t.maxDelay = 0
	t.unbounded = target.StopTime > currentTimeMillis()-streamingThresholdMinutes*60*1000
}

func (t *SignalFxJobHandler) initializeTimeRange(target *Target) {
	t.startTime = target.StartTime
	t.stopTime = target.StopTime
	t.cutoffTime = min(currentTimeMillis(), t.stopTime)
}

func currentTimeMillis() int64 {
	return time.Now().UnixNano() / 1e6
}

func min(x, y int64) int64 {
	if x > y {
		return y
	}
	return x
}

func (t *SignalFxJobHandler) execute() (*signalflow.Channel, error) {
	request := &signalflow.ExecuteRequest{
		Program: t.program,
		Start:   t.startTime,
	}
	if t.intervalMs > 0 {
		request.Resolution = int32(t.intervalMs)
	}
	if !t.unbounded {
		request.Stop = t.stopTime
		request.Immediate = true
	}
	t.logger.Debug("Starting job", "program", t.program)
	return t.client.Execute(request)
}

func (t *SignalFxJobHandler) reuse(target *Target) (chan []*datasource.TimeSeries, error) {
	// Re-use this handler only if it has already processed the initial request
	// so that enough data is collected in the buffer and we can return it immediately
	if t.isJobReusable(target) && t.batchOut == nil {
		t.initializeTimeRange(target)
		out := make(chan []*datasource.TimeSeries, 1)
		t.flushData(out)
		t.updateLastUsed()
		return out, nil
	}
	return nil, nil
}

func (t *SignalFxJobHandler) isJobReusable(target *Target) bool {
	return t.program == target.Program &&
		t.intervalMs == target.IntervalMs &&
		t.startTime <= target.StartTime &&
		((t.channel != nil && t.unbounded) || t.stopTime >= target.StopTime)
}

func (t *SignalFxJobHandler) updateLastUsed() {
	t.lastUsed = time.Now()
}

func (t *SignalFxJobHandler) readMessages() {
	for msg := range t.channel.Messages() {
		if dm, ok := msg.(*signalflow.DataMessage); ok {
			if t.handleDataMessage(dm) {
				t.flushData(t.batchOut)
			}
		} else if m, ok := msg.(*signalflow.BaseControlMessage); ok {
			if t.handleControlMessage(m) {
				break
			}
		} else if m, ok := msg.(*signalflow.MessageMessage); ok {
			t.handleMessageMessage(m)
		} else if m, ok := msg.(*signalflow.MetadataMessage); ok {
			t.handleMetadataMessage(m)
		} else if m, ok := msg.(*signalflow.WebsocketErrorMessage); ok {
			t.handleErrorMessage(m)
			break
		} else {
			log.Printf("Message Type: %v %v", msg.Type(), msg)
		}
	}
	t.flushData(t.batchOut)
	t.stop()
}

func (t *SignalFxJobHandler) handleDataMessage(m *signalflow.DataMessage) bool {
	var timestamp = int64(m.TimestampMillis)
	for _, pl := range m.Payloads {
		tsid := pl.Tsid
		value := pl.Value()
		if (t.Points[tsid]) == nil {
			t.Points[tsid] = make([]*datasource.Point, 0)
		}
		t.Points[tsid] = append(t.Points[tsid], &datasource.Point{
			Timestamp: int64(timestamp),
			Value:     toFloat64(value),
		})
	}
	if t.resolution > 0 {
		// Estimate the timestamp of the last datapoint already available in the system
		nextEstimatedTimestamp := timestamp + int64(math.Ceil(float64(t.maxDelay)/float64(t.resolution)+1))*t.resolution
		roundedCutoffTime := int64(math.Floor(float64(t.cutoffTime)/float64(t.resolution))) * t.resolution
		return nextEstimatedTimestamp > roundedCutoffTime
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

func (t *SignalFxJobHandler) handleControlMessage(m *signalflow.BaseControlMessage) bool {
	log.Printf("Event: %v", m.Event)
	switch m.Event {
	case "END_OF_CHANNEL", "CHANNEL_ABORT":
		return true
	}
	return false
}

func (t *SignalFxJobHandler) handleMessageMessage(m *signalflow.MessageMessage) {
	switch m.MessageBlock.Code {
	case "JOB_RUNNING_RESOLUTION":
		n, _ := strconv.ParseInt(fmt.Sprintf("%v", m.MessageBlock.Contents["resolutionMs"]), 10, 64)
		t.resolution = n
		t.logger.Debug("Resolution", "value", t.resolution)
	case "JOB_INITIAL_MAX_DELAY":
		n, _ := strconv.ParseInt(fmt.Sprintf("%v", m.MessageBlock.Contents["maxDelayMs"]), 10, 64)
		t.maxDelay = n
		t.logger.Debug("Max Delay", "value", t.resolution)
	default:
		log.Printf("Message: %v", m.MessageBlock)
	}
}

func (t *SignalFxJobHandler) handleMetadataMessage(m *signalflow.MetadataMessage) {
	log.Printf("Meta: %v", m)
}

func (t *SignalFxJobHandler) handleErrorMessage(m *signalflow.WebsocketErrorMessage) {
	t.logger.Error("Error", "error", m.Error)
}

func (t *SignalFxJobHandler) stop() {
	if t.running {
		t.logger.Debug("Stopping job", "program", t.program)
		t.channel.Close()
		t.running = false
	}
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
		s := &datasource.TimeSeries{Name: t.getTimeSeriesName(id), Points: points}
		series = append(series, s)
	}
	return series
}

// TODO: Use metadata to map tsid onto some meaningful name
func (t *SignalFxJobHandler) getTimeSeriesName(tsid int64) string {
	return "series_name"
}

func (t *SignalFxJobHandler) trimDatapoints() {
	trimTimestamp := t.startTime - maxDatapointsToKeepBeforeTimerange*t.resolution
	for tsid, ss := range t.Points {
		for len(ss) > 0 && trimTimestamp > ss[0].Timestamp {
			ss = ss[1:]
		}
		t.Points[tsid] = ss
	}
}

func (t *SignalFxJobHandler) isActive(time time.Time) bool {
	return time.UnixNano() < t.lastUsed.UnixNano()+inactiveJobMinutes*60*1e9
}
