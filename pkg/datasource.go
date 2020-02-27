package main

import (
	"encoding/json"
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
}

type DatasourceInfo struct {
	AccessToken string
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
	}
	tick := time.NewTicker(time.Second * 30)
	go datasource.cleanup(tick)
	return datasource
}

func (t *SignalFxDatasource) Query(ctx context.Context, tsdbReq *datasource.DatasourceRequest) (*datasource.DatasourceResponse, error) {

	t.logger.Debug("Running query", "req", tsdbReq)

	err := t.createClient(tsdbReq.Datasource)
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
	t.logger.Info("Sending response", "response", response)
	return response, nil
}

func (t *SignalFxDatasource) createClient(datasource *datasource.DatasourceInfo) error {

	url, err := t.buildURL(datasource)
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

func (t *SignalFxDatasource) buildURL(datasourceInfo *datasource.DatasourceInfo) (string, error) {
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
	if err := json.Unmarshal([]byte(datasourceInfo.JsonData), &dsInfo); err != nil {
		return nil, err
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
