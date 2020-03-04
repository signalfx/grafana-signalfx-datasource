// Copyright (C) 2019-2020 Splunk, Inc. All rights reserved.
package main

import (
	"encoding/json"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/grafana/grafana_plugin_model/go/datasource"
	hclog "github.com/hashicorp/go-hclog"
	plugin "github.com/hashicorp/go-plugin"
	"github.com/signalfx/signalfx-go/signalflow"
	"golang.org/x/net/context"
)

type SignalFxDatasource struct {
	plugin.NetRPCUnsupportedPlugin
	logger       hclog.Logger
	handlers     []SignalFxJob
	client       *signalflow.Client
	url          string
	token        string
	handlerMutex sync.Mutex
	clientMutex  sync.Mutex
	apiClient    *SignalFxApiClient
}

type DatasourceInfo struct {
	AccessToken string `json:"accessToken"`
}

type Target struct {
	RefID     string        `json:"refId"`
	Program   string        `json:"program"`
	StartTime time.Time     `json:"-"`
	StopTime  time.Time     `json:"-"`
	Interval  time.Duration `json:"-"`
	Alias     string        `json:"alias"`
	MaxDelay  int64         `json:"maxDelay"`
}

func NewSignalFxDatasource() *SignalFxDatasource {
	datasource := &SignalFxDatasource{
		logger:       pluginLogger,
		handlers:     make([]SignalFxJob, 0),
		clientMutex:  sync.Mutex{},
		handlerMutex: sync.Mutex{},
		apiClient:    NewSignalFxApiClient(pluginLogger),
	}
	tick := time.NewTicker(time.Second * 30)
	go datasource.cleanup(tick)
	return datasource
}

func (t *SignalFxDatasource) Query(ctx context.Context, tsdbReq *datasource.DatasourceRequest) (*datasource.DatasourceResponse, error) {

	t.logger.Debug("Running query", "req", tsdbReq)

	var apiCall SignalFxApiCall
	if err := json.Unmarshal([]byte(tsdbReq.Queries[0].ModelJson), &apiCall); err != nil {
		t.logger.Error("Could not unmarshal query", "error", err)
		return nil, err
	}

	switch apiCall.Path {
	case "/v2/metric":
		apiCall.Method = http.MethodGet
		return t.getMetrics(tsdbReq, &apiCall)
	case "/v2/suggest/_signalflowsuggest":
		apiCall.Method = http.MethodPost
		return t.getSuggestions(tsdbReq, &apiCall)
	}

	return t.getDatapoints(tsdbReq)
}

func (t *SignalFxDatasource) getMetrics(tsdbReq *datasource.DatasourceRequest, apiCall *SignalFxApiCall) (*datasource.DatasourceResponse, error) {
	response := MetricResponse{}
	t.makeAPICall(tsdbReq, apiCall, &response)
	t.logger.Debug("Unmarshalled API response", "response", response)
	values := make([]string, 0)
	for _, r := range response.Results {
		values = append(values, r.Name)
	}
	return t.formatAsTable(values), nil
}

func (t *SignalFxDatasource) getSuggestions(tsdbReq *datasource.DatasourceRequest, apiCall *SignalFxApiCall) (*datasource.DatasourceResponse, error) {
	response := make([]string, 0)
	t.makeAPICall(tsdbReq, apiCall, &response)
	t.logger.Debug("Unmarshalled API response", "response", response)
	return t.formatAsTable(response), nil
}

func (t *SignalFxDatasource) formatAsTable(values []string) *datasource.DatasourceResponse {
	table := &datasource.Table{
		Columns: make([]*datasource.TableColumn, 0),
		Rows:    make([]*datasource.TableRow, 0),
	}
	table.Columns = append(table.Columns, &datasource.TableColumn{Name: "name"})
	for _, r := range values {
		row := &datasource.TableRow{}
		row.Values = append(row.Values, &datasource.RowValue{Kind: datasource.RowValue_TYPE_STRING, StringValue: r})
		table.Rows = append(table.Rows, row)
	}
	return &datasource.DatasourceResponse{
		Results: []*datasource.QueryResult{
			{
				RefId:  "items",
				Tables: []*datasource.Table{table},
			},
		},
	}
}

func (t *SignalFxDatasource) makeAPICall(tsdbReq *datasource.DatasourceRequest, apiCall *SignalFxApiCall, response interface{}) error {
	apiCall.BaseURL = tsdbReq.Datasource.Url
	t.logger.Debug("Making API Call", "call", apiCall)
	dsInfo, err := t.getDsInfo(tsdbReq.Datasource)
	if err != nil {
		return err
	}
	apiCall.Token = dsInfo.AccessToken
	return t.apiClient.doRequest(apiCall, &response)
}

func (t *SignalFxDatasource) getDatapoints(tsdbReq *datasource.DatasourceRequest) (*datasource.DatasourceResponse, error) {
	err := t.createSignalflowClient(tsdbReq.Datasource)
	if err != nil {
		t.logger.Error("Could not create SignalFlow client", "error", err)
		return nil, err
	}

	targets, err := t.buildTargets(tsdbReq)
	if err != nil {
		t.logger.Error("Could not parse queries", "error", err)
		return nil, err
	}

	response := &datasource.DatasourceResponse{}
	for _, target := range targets {
		ch, err := t.startJobHandler(target)
		if err != nil {
			t.logger.Error("Could not execute request", "error", err)
			return nil, err
		}
		s := <-ch
		result := &datasource.QueryResult{
			RefId:  target.RefID,
			Series: s,
		}
		response.Results = append(response.Results, result)
	}
	return response, nil
}

func (t *SignalFxDatasource) createSignalflowClient(datasource *datasource.DatasourceInfo) error {

	url, err := t.buildSignalflowURL(datasource)
	if err != nil {
		return err
	}

	dsInfo, err := t.getDsInfo(datasource)
	if err != nil {
		return err
	}

	token := dsInfo.AccessToken

	t.clientMutex.Lock()
	defer t.clientMutex.Unlock()
	// Remove existing client if configuration changes
	if t.client != nil && (t.url != url || t.token != token) {
		t.client.Close()
		t.client = nil
	}

	if t.client == nil {
		c, err := signalflow.NewClient(
			signalflow.StreamURL(url),
			signalflow.AccessToken(dsInfo.AccessToken),
			signalflow.UserAgent("grafana"))
		if err != nil {
			return err
		}
		t.client = c
		t.url = url
		t.token = token
	}

	return nil
}

func (t *SignalFxDatasource) buildSignalflowURL(datasourceInfo *datasource.DatasourceInfo) (string, error) {
	sfxURL, err := url.Parse(datasourceInfo.Url)
	if err != nil {
		return "", err
	}
	scheme := "wss"
	if sfxURL.Scheme == "http" || sfxURL.Scheme == "" {
		scheme = "ws"
	}
	return scheme + "://" + sfxURL.Host + "/v2/signalflow", nil
}

func (t *SignalFxDatasource) getDsInfo(datasourceInfo *datasource.DatasourceInfo) (*DatasourceInfo, error) {
	var dsInfo DatasourceInfo
	if val, ok := datasourceInfo.DecryptedSecureJsonData["accessToken"]; ok {
		dsInfo.AccessToken = val
	} else {
		if err := json.Unmarshal([]byte(datasourceInfo.JsonData), &dsInfo); err != nil {
			return nil, err
		}
	}
	return &dsInfo, nil
}

func (t *SignalFxDatasource) startJobHandler(target Target) (<-chan []*datasource.TimeSeries, error) {
	t.handlerMutex.Lock()
	defer t.handlerMutex.Unlock()
	// Try to re-use any existing job if possible
	for _, h := range t.handlers {
		ch := h.reuse(&target)
		if ch != nil {
			return ch, nil
		}
	}

	handler := &SignalFxJobHandler{
		logger: t.logger,
		client: t.client,
	}
	ch, err := handler.start(&target)
	if ch != nil {
		t.handlers = append(t.handlers, handler)
	}
	return ch, err
}

func (t *SignalFxDatasource) buildTargets(tsdbReq *datasource.DatasourceRequest) ([]Target, error) {
	startTime := time.Unix(0, tsdbReq.TimeRange.FromEpochMs*int64(time.Millisecond))
	stopTime := time.Unix(0, tsdbReq.TimeRange.ToEpochMs*int64(time.Millisecond))
	targets := make([]Target, 0)
	for _, query := range tsdbReq.Queries {
		target := Target{}
		target.MaxDelay = 0
		if err := json.Unmarshal([]byte(query.ModelJson), &target); err != nil {
			return nil, err
		}
		target.Interval = time.Duration(query.IntervalMs) * time.Millisecond
		target.StartTime = startTime
		target.StopTime = stopTime
		targets = append(targets, target)
	}
	return targets, nil
}

func (t *SignalFxDatasource) cleanup(ticker *time.Ticker) {
	for time := range ticker.C {
		t.cleanupInactiveJobHandlers(time)
	}
}

func (t *SignalFxDatasource) cleanupInactiveJobHandlers(time time.Time) {
	t.handlerMutex.Lock()
	active := make([]SignalFxJob, 0)
	for _, h := range t.handlers {
		if h.isActive(time) {
			active = append(active, h)
		} else {
			t.logger.Debug("Stopping inactive job", "program", h.Program())
			h.stop()
		}
	}
	t.handlers = active
	t.handlerMutex.Unlock()
}
