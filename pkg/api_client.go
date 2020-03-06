// Copyright (C) 2019-2020 Splunk, Inc. All rights reserved.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"net/url"
	"path"
	"time"

	hclog "github.com/hashicorp/go-hclog"
)

type SignalFxApiCall struct {
	BaseURL string `json:"-"`
	Method  string `json:"-"`
	Token   string `json:"-"`
	Path    string `json:"path"`
	Query   string `json:"query"`
	Data    string `json:"data"`
}

type SignalFxApiClient struct {
	logger     hclog.Logger
	httpClient *http.Client
}

type MetricResponseItem struct {
	Name string `json:"name"`
}

type MetricResponse struct {
	Results []MetricResponseItem `json:"results"`
}

func NewSignalFxApiClient(logger hclog.Logger) *SignalFxApiClient {
	client := &SignalFxApiClient{
		logger: pluginLogger,
		httpClient: &http.Client{
			Timeout: time.Second * 30,
		},
	}
	return client
}

func (t *SignalFxApiClient) doRequest(apiCall *SignalFxApiCall, response interface{}) error {
	u, err := url.Parse(apiCall.BaseURL)
	if err != nil {
		t.logger.Error("Error parsing SignalFx API URL", "error", err)
		return err
	}
	u.Path = path.Join(u.Path, apiCall.Path)
	u.RawQuery = apiCall.Query
	var req *http.Request
	if apiCall.Method == http.MethodPost {
		req, err = http.NewRequest(http.MethodPost, u.String(), bytes.NewBuffer([]byte(apiCall.Data)))
	} else {
		req, err = http.NewRequest(http.MethodGet, u.String(), nil)
	}
	if err != nil {
		t.logger.Error("Error creating request to SignalFx API", "error", err)
		return err
	}
	req.Header.Set("X-SF-TOKEN", apiCall.Token)
	if apiCall.Method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}
	rsp, err := t.httpClient.Do(req)
	if err != nil {
		t.logger.Error("Error calling SignalFx API", "error", err)
		return err
	}
	defer rsp.Body.Close()
	if rsp.StatusCode/100 != 2 {
		message, _ := ioutil.ReadAll(rsp.Body)
		err = fmt.Errorf("Bad status %d: %s", rsp.StatusCode, message)
		t.logger.Error("Error response from SignalFx API", "error", err)
		return err
	}

	err = json.NewDecoder(rsp.Body).Decode(response)
	if err != nil {
		t.logger.Error("Error decoding response from SignalFx API", "error", err)
		return err
	}
	return nil
}
