// Copyright (C) 2019-2020 Splunk, Inc. All rights reserved.
package main

import (
	"testing"
	"time"

	"github.com/grafana/grafana_plugin_model/go/datasource"
	hclog "github.com/hashicorp/go-hclog"
	"github.com/signalfx/signalfx-go/idtool"
	"github.com/signalfx/signalfx-go/signalflow"
	"github.com/signalfx/signalfx-go/signalflow/messages"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

var jobHandlerTestLogger = hclog.New(&hclog.LoggerOptions{
	Name:  "signalfx-datasource",
	Level: hclog.LevelFromString("DEBUG"),
})

type signalflowClientMock struct {
	mock.Mock
}

type signalflowComputationMock struct {
	mock.Mock
}

func (m *signalflowClientMock) Execute(req *signalflow.ExecuteRequest) (*signalflow.Computation, error) {
	args := m.Called(req)
	return args.Get(0).(*signalflow.Computation), args.Error(1)
}

func (m *signalflowComputationMock) IsFinished() bool {
	args := m.Called()
	return args.Bool(0)
}

func (m *signalflowComputationMock) Data() <-chan *messages.DataMessage {
	args := m.Called()
	return args.Get(0).(<-chan *messages.DataMessage)
}

func (m *signalflowComputationMock) Done() <-chan struct{} {
	args := m.Called()
	return args.Get(0).(<-chan struct{})
}

func (m *signalflowComputationMock) Err() error {
	args := m.Called()
	return args.Error(0)
}

func (m *signalflowComputationMock) MaxDelay() time.Duration {
	args := m.Called()
	return args.Get(0).(time.Duration)
}

func (m *signalflowComputationMock) Resolution() time.Duration {
	args := m.Called()
	return args.Get(0).(time.Duration)
}

func (m *signalflowComputationMock) Stop() error {
	args := m.Called()
	return args.Error(0)
}

func (m *signalflowComputationMock) TSIDMetadata(tsid idtool.ID) *messages.MetadataProperties {
	args := m.Called()
	return args.Get(0).(*messages.MetadataProperties)
}

func TestInitialize(t *testing.T) {
	// Given
	client := signalflow.Client{}
	handler := &SignalFxJobHandler{
		client: &client,
	}
	target := &Target{
		StartTime: time.Now().Add(-time.Duration(time.Minute * 15)),
		StopTime:  time.Now(),
		Program:   "some_program",
		Interval:  time.Duration(time.Second),
	}
	// When
	handler.initialize(target)
	// Then
	assert.Equal(t, target.Program, handler.program)
	assert.Equal(t, target.Interval, handler.interval)
	assert.Equal(t, true, handler.unbounded)
}

func TestInitializeTimeRange(t *testing.T) {
	// Given
	handler := &SignalFxJobHandler{}
	target := &Target{
		StartTime: time.Now().Add(-time.Duration(time.Minute * 15)),
		StopTime:  time.Now(),
	}
	// When
	handler.initializeTimeRange(target)
	// Then
	assert.Equal(t, target.StartTime, handler.startTime)
	assert.Equal(t, target.StopTime, handler.stopTime)
	assert.Equal(t, target.StopTime, handler.cutoffTime)
}

func TestIsActive(t *testing.T) {
	// Given
	inactiveHandler := &SignalFxJobHandler{
		lastUsed: time.Now().Add(-time.Duration(time.Minute * 10)),
	}
	activeHandler := &SignalFxJobHandler{
		lastUsed: time.Now().Add(-time.Duration(time.Minute * 1)),
	}
	// When
	active := activeHandler.isActive(time.Now())
	inactive := inactiveHandler.isActive(time.Now())
	// Then
	assert.True(t, active)
	assert.False(t, inactive)
}

func TestReusePrefetchedData(t *testing.T) {
	// Given
	computation := new(signalflowComputationMock)
	computation.On("IsFinished").Return(false)
	computation.On("Resolution").Return(time.Second)
	client := new(signalflowClientMock)
	target := &Target{
		StartTime: time.Now().Add(-time.Duration(time.Minute * 10)),
		StopTime:  time.Now(),
		Program:   "some_program",
		Interval:  time.Duration(time.Second),
	}
	handler := &SignalFxJobHandler{
		client:      client,
		logger:      jobHandlerTestLogger,
		startTime:   time.Now().Add(-time.Duration(time.Minute * 15)),
		stopTime:    time.Now(),
		unbounded:   true,
		program:     "some_program",
		computation: computation,
		interval:    time.Duration(time.Second),
		Points:      make(map[int64]([]*datasource.Point)),
	}
	// When
	reused := handler.reuse(target)
	// Then
	assert.NotNil(t, reused)
}

func TestExecute(t *testing.T) {
	// Given
	computation := signalflow.Computation{}
	client := new(signalflowClientMock)
	client.On("Execute", mock.Anything).Return(&computation, nil)
	handler := &SignalFxJobHandler{
		client:    client,
		logger:    jobHandlerTestLogger,
		startTime: time.Now().Add(-time.Duration(time.Minute * 15)),
		stopTime:  time.Now(),
		program:   "some_program",
	}
	// When
	c, _ := handler.execute()
	// Then
	client.AssertNumberOfCalls(t, "Execute", 1)
	assert.Equal(t, &computation, c)
}

func TestIsJobReusableForFixedPeriod(t *testing.T) {
	// Given
	computation := new(signalflowComputationMock)
	computation.On("IsFinished").Return(true)
	target := &Target{
		StartTime: time.Now().Add(-time.Duration(time.Minute * 15)),
		StopTime:  time.Now(),
		Program:   "some_program",
		Interval:  time.Duration(time.Second),
	}
	handler := &SignalFxJobHandler{
		logger:      jobHandlerTestLogger,
		startTime:   target.StartTime,
		stopTime:    time.Now(),
		interval:    target.Interval,
		computation: computation,

		unbounded: false,
		program:   "some_program",
	}
	// When
	reusable := handler.isJobReusable(target)
	// Then
	assert.True(t, reusable)
}

func TestIsJobReusableForUnboundedStream(t *testing.T) {
	// Given
	computation := new(signalflowComputationMock)
	computation.On("IsFinished").Return(false)
	target := &Target{
		StartTime: time.Now().Add(-time.Duration(time.Minute * 15)),
		StopTime:  time.Now(),
		Program:   "some_program",
		Interval:  time.Duration(time.Second),
	}
	handler := &SignalFxJobHandler{
		logger:      jobHandlerTestLogger,
		startTime:   target.StartTime,
		stopTime:    target.StartTime.Add(time.Duration(time.Minute * 10)),
		interval:    target.Interval,
		computation: computation,

		unbounded: true,
		program:   "some_program",
	}
	// When
	reusable := handler.isJobReusable(target)
	// Then
	assert.True(t, reusable)
}

func TestIsJobReusableForFinishedUnboundedStream(t *testing.T) {
	// Given
	computation := new(signalflowComputationMock)
	computation.On("IsFinished").Return(true)
	target := &Target{
		StartTime: time.Now().Add(-time.Duration(time.Minute * 15)),
		StopTime:  time.Now(),
		Program:   "some_program",
		Interval:  time.Duration(time.Second),
	}
	handler := &SignalFxJobHandler{
		logger:      jobHandlerTestLogger,
		startTime:   time.Now().Add(-time.Duration(time.Minute * 20)),
		stopTime:    target.StartTime.Add(time.Duration(time.Minute * 10)),
		interval:    target.Interval,
		computation: computation,

		unbounded: true,
		program:   "some_program",
	}
	// When
	reusable := handler.isJobReusable(target)
	// Then
	assert.False(t, reusable)
}

func TestReadDataMessage(t *testing.T) {
	// Given
	target := &Target{
		StartTime: time.Now().Add(-time.Duration(time.Minute * 15)),
		StopTime:  time.Now(),
		Program:   "some_program",
		Interval:  time.Duration(time.Second),
	}
	computation := new(signalflowComputationMock)
	batchOut := make(chan []*datasource.TimeSeries)
	handler := &SignalFxJobHandler{
		logger:      jobHandlerTestLogger,
		startTime:   time.Now().Add(-time.Duration(time.Minute * 20)),
		stopTime:    target.StartTime.Add(time.Duration(time.Minute * 10)),
		interval:    target.Interval,
		computation: computation,
		batchOut:    batchOut,
		unbounded:   true,
		program:     "some_program",
		Points:      make(map[int64]([]*datasource.Point)),
	}
	data := make(chan *messages.DataMessage, 2)
	done := make(chan struct{})
	computation.On("Done").Return(modifyDone(done))
	computation.On("Data").Return(modifyData(data))
	computation.On("MaxDelay").Return(time.Second)
	computation.On("Resolution").Return(time.Second)
	customProperties := make(map[string]string)
	customProperties["metric_source"] = "kubernetes"
	internalProperties := make(map[string]interface{})
	internalProperties["sf_key"] = []string{"kubernetes_node", "sf_originatingMetric", "sf_metric", "computationId"}
	internalProperties["sf_streamLabel"] = "D"
	metadata := messages.MetadataProperties{
		Metric:             "metric_name",
		CustomProperties:   customProperties,
		InternalProperties: internalProperties,
	}
	tsid := idtool.ID(123)
	computation.On("TSIDMetadata", mock.Anything).Return(&metadata)
	message := &messages.DataMessage{}
	message.TimestampMillis = uint64(handler.stopTime.UnixNano() / int64(time.Millisecond))
	message.Payloads = make([]messages.DataPayload, 1)
	message.Payloads[0] = messages.DataPayload{
		Type: 1,
		TSID: tsid,
	}
	data <- message
	// When
	go handler.readDataMessages()
	c := <-handler.batchOut
	// Then
	assert.Equal(t, 1, len(c))
	assert.Equal(t, metadata.Metric, c[0].Name)
	assert.Equal(t, 1, len(c[0].Points))
	expectedTags := make(map[string]string)
	expectedTags["sf_streamLabel"] = "\"D\""
	expectedTags["metric_source"] = "\"kubernetes\""
	expectedTags["sf_key"] = "[\"kubernetes_node\",\"sf_originatingMetric\",\"sf_metric\",\"computationId\"]"
	assert.Equal(t, expectedTags, c[0].Tags)
}

func modifyDone(ch chan struct{}) <-chan struct{} {
	return ch
}

func modifyData(ch chan *messages.DataMessage) <-chan *messages.DataMessage {
	return ch
}
