package main

import (
	"testing"
	"time"

	"github.com/grafana/grafana_plugin_model/go/datasource"
	hclog "github.com/hashicorp/go-hclog"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

var datasourceHandlerTestLogger = hclog.New(&hclog.LoggerOptions{
	Name:  "signalfx-datasource",
	Level: hclog.LevelFromString("DEBUG"),
})

type signalflowJob struct {
	mock.Mock
}

func (m *signalflowJob) stop() {
	m.Called()
}

func (m *signalflowJob) isActive(time time.Time) bool {
	args := m.Called()
	return args.Bool(0)
}

func (m *signalflowJob) reuse(target *Target) <-chan []*datasource.TimeSeries {
	args := m.Called()
	return args.Get(0).(<-chan []*datasource.TimeSeries)
}

func (m *signalflowJob) Program() string {
	args := m.Called()
	return args.String(0)
}

func TestBuildURL(t *testing.T) {
	// Given
	ds := &SignalFxDatasource{}
	dsInfo := &datasource.DatasourceInfo{}
	dsInfo.Url = "https://stream.us1.signalfx.com"
	// When
	url, _ := ds.buildURL(dsInfo)
	// Then
	assert.NotNil(t, url)
	assert.Equal(t, "wss://stream.us1.signalfx.com/v2/signalflow", url)
}

func TestBuildTargets(t *testing.T) {
	// Given
	ds := &SignalFxDatasource{}
	req := &datasource.DatasourceRequest{}
	req.TimeRange = &datasource.TimeRange{}
	req.TimeRange.FromEpochMs = 1560761879121
	req.TimeRange.ToEpochMs = 1560762879121
	req.Queries = make([]*datasource.Query, 1)
	req.Queries[0] = &datasource.Query{}
	req.Queries[0].ModelJson = "{\"refId\": \"ref123\", \"program\": \"some program\"}"
	req.Queries[0].IntervalMs = 1000
	// When
	targets, _ := ds.buildTargets(req)
	// Then
	assert.NotNil(t, targets)
	assert.Equal(t, 1, len(targets))
	assert.Equal(t, 1000, int(targets[0].Interval)/int(time.Millisecond))
	assert.Equal(t, "some program", targets[0].Program)
	assert.Equal(t, "ref123", targets[0].RefID)
	assert.Equal(t, req.TimeRange.FromEpochMs, targets[0].StartTime.UnixNano()/int64(time.Millisecond))
	assert.Equal(t, req.TimeRange.ToEpochMs, targets[0].StopTime.UnixNano()/int64(time.Millisecond))
}

func TestCleanupInactiveJobHandlers(t *testing.T) {
	// Given
	ds := &SignalFxDatasource{
		logger: datasourceHandlerTestLogger,
	}
	job1 := new(signalflowJob)
	job1.On("isActive").Return(true)
	job1.On("Program").Return("program1")
	job1.On("stop")
	job2 := new(signalflowJob)
	job2.On("isActive").Return(false)
	job2.On("Program").Return("program1")
	job2.On("stop")
	ds.handlers = make([]SignalFxJob, 2)
	ds.handlers[0] = job1
	ds.handlers[1] = job2
	time := time.Now()
	// When
	ds.cleanupInactiveJobHandlers(time)
	// Then
	job1.AssertNumberOfCalls(t, "stop", 0)
	job2.AssertNumberOfCalls(t, "stop", 1)
}
