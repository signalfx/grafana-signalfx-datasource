// Copyright (C) 2019-2020 Splunk, Inc. All rights reserved.
import _ from "lodash";
import signalfx from './signalfx';
import {StreamHandler} from './stream_handler';
import {ProxyHandler} from './proxy_handler';

export class SignalFxDatasource {

  constructor(instanceSettings, $q, backendSrv, templateSrv) {
    this.datasourceId = instanceSettings.id;
    this.type = instanceSettings.type;
    this.url = instanceSettings.url;
    this.name = instanceSettings.name;
    this.q = $q;
    this.backendSrv = backendSrv;
    this.templateSrv = templateSrv;
    this.withCredentials = instanceSettings.withCredentials;
    this.authToken = instanceSettings.jsonData.accessToken;
    this.headers = {'Content-Type': 'application/json'};
    if (this.url.startsWith("/")) {
      this.proxyAccess = true;
    } else {
      this.headers['X-SF-TOKEN'] = this.authToken;
      this.endpoint = instanceSettings.url.replace(/^(http)(s)?:/, function(match, p1, p2) {
        return 'ws' + (p2 || '') + ':';
      });
      console.log('Using SignalFx at ' + this.endpoint);
      this.signalflow = window.signalfx.streamer.SignalFlow(this.authToken, {
        signalflowEndpoint: this.endpoint,
      });
    }
    this.streams = [];
    // give interpolateQueryStr access to this
    this.interpolateQueryStr = this.interpolateQueryStr.bind(this);
  }

  query(options) {
    const queries = _.filter(options.targets, t => {return t.hide !== true;})
    .map(t => this.templateSrv.replace(t.program, options.scopedVars, this.interpolateQueryStr));
    const program = queries.join('\n');

    const aliases = this.collectAliases(options);
    const maxDelay = this.getMaxDelay(options);

    // TODO: Better validation can be implemented here 
    if (!program) {
      return Promise.resolve({data: []});
    }
    return this.getSignalflowHandler(options).start(program, aliases, maxDelay, options);
  }

  collectAliases(options) {
    return _.fromPairs(_.filter(options.targets, t => {return t.hide !== true && t.program && t.alias;})
      .map(t => {return {program: this.templateSrv.replace(t.program, options.scopedVars || {}, this.interpolateQueryStr), alias: t.alias};})
      .flatMap(t => this.extractLabelsWithAlias(t.program, t.alias)));
  }

  extractLabelsWithAlias(program, alias) {
    const re = /label\s?=\s?'([\w]*?)'/igm;
    const labels = [];
    let m;
    do {
        m = re.exec(program);
        if (m) {
          labels.push([m[1], alias]);
        }
    } while (m);
    return labels;
  }

  getMaxDelay(options) {
    let maxDelay = _.max(_.map(options.targets, t => t.maxDelay));
    if (!maxDelay)
      maxDelay = 0;
    return maxDelay;
  }

  getSignalflowHandler(options) {
    if (this.proxyAccess) {
      return new ProxyHandler(this.datasourceId, this.backendSrv, this.templateSrv);
    }
    let handler = this.streams[options.panelId];
    if (!handler) {
      handler = new StreamHandler(this.signalflow, this.templateSrv);
      this.streams[options.panelId] = handler;
    }
    return handler;
  }

  testDatasource() {
    return this.doRequest({
      url: '/v2/metric',
      method: 'GET',
    }).then(response => {
      if (response.status === 200) {
        return { status: "success", message: "Data source is working", title: "Success" };
      }
    });
  }

  metricFindQuery(query) {
    const metricNameQuery = query.match(/^metrics\(([^\)]*?)\)/);
    if (metricNameQuery) {
      return this.getMetrics(this.templateSrv.replace(metricNameQuery[1]));
    }
    const propertyKeysQuery = query.match(/^property_keys\(([^\)]+?)(,\s?([^,]+?))?\)/);
    if (propertyKeysQuery) {
      return this.getPropertyKeys(this.templateSrv.replace(propertyKeysQuery[1]), this.templateSrv.replace(propertyKeysQuery[3]));
    }
    const propertyValuesQuery = query.match(/^property_values\(([^,]+?),\s?([^,]+?)(,\s?(.+))?\)/);
    if (propertyValuesQuery) {
      return this.getPropertyValues(this.templateSrv.replace(propertyValuesQuery[1]), this.templateSrv.replace(propertyValuesQuery[2]), this.templateSrv.replace(propertyValuesQuery[4]));
    }
    const tagsQuery = query.match(/^tags\(([^\)]+?)(,\s?([^,]+?))?\)/);
    if (tagsQuery) {
      return this.getTags(this.templateSrv.replace(tagsQuery[1]), this.templateSrv.replace(tagsQuery[3]));
    }
    // var globalTagsQuery = query.match(/^tags\(([^\)]*?)\)/);
    // if (globalTagsQuery) {
    //   return this.getGlobalTags(this.templateSrv.replace(globalTagsQuery[1]));
    // }
    this.q.when([]);
  }

  getMetrics(query) {
    let mapFunc = this.proxyAccess ? this.mapPropertiesToTextValue : this.mapMetricsToTextValue;
    return this.doQueryRequest('/v2/metric', 'name:' + (query ? query : '*'))
      .then(mapFunc);
  }

  mapMetricsToTextValue(result) {
    return _.map(result.data.results, d => {
      return { text: d.name, value: d.name };
    });
  }

  getPropertyKeys(metric, partialInput) {
    return this.doSuggestQueryRequest(metric, null, partialInput);
  }

  getPropertyValues(metric, propertyKey, partialInput) {
    return this.doSuggestQueryRequest(metric, propertyKey, partialInput);
  }

  getTags(metric, partialInput) {
    return this.doSuggestQueryRequest(metric, 'sf_tags', partialInput);
  }

  mapPropertiesToTextValue(result) {
    return _.map(result.data, d => {
      return { text: d, value: d };
    });
  }

  // getGlobalTags(query) {
  //   return this.doQueryRequest('/v2/tag', query)
  //     .then(this.mapMetricsToTextValue);
  // }

  doQueryRequest(path, query) {
    return this.doRequest({
      url: path,
      params: {query: this.escapeQuery(query), limit: 100},
      method: 'GET',
    });
  }

  doSuggestQueryRequest(metric, property, partialInput) {
    const program = {
      programText: 'data(\'' + metric +'\').publish(label=\'A\')',
      packageSpecifications: ''
    };
    const request = {
      programs: [program],
      property,
      partialInput: partialInput != null ? partialInput : '',
      limit: 100,
      additionalFilters: [],
      additionalReplaceOnlyFilters:[],
      additionalQuery: null
    };
    return this.doRequest({
      url: '/v2/suggest/_signalflowsuggest',
      data: JSON.stringify(request),
      method: 'POST'
    })
    .then(this.mapPropertiesToTextValue);
  }

  escapeQuery(query) {
    return query.replace(/[\/]/g, '\\$&');
  }

  doRequest(options) {
    if (this.proxyAccess) {
      return this.doBackendProxyRequest(options);
    }
    options.headers = this.headers;
    options.url = this.url + options.url;
    return this.backendSrv.datasourceRequest(options);
  }

  doBackendProxyRequest(options) {
    options.data = {
      queries: [{
        datasourceId: this.datasourceId,
        path: options.url,
        query: _.toPairs(options.params).map(p => p[0] + '=' + p[1]).join('&'),
        data: options.data
      }]
    };
    options.url = '/api/tsdb/query';
    options.method =  'POST';
    return this.backendSrv.datasourceRequest(options).then(this.mapBackendProxyResponse);
  }

  mapBackendProxyResponse(response) {
    const table = response.data.results.items.tables[0];
    const results = []
    for (let row = 0; row < table.rows.length; row++) {
      results.push(table.rows[row][0]);
    }
    response.data = results;
    return response;
  }

  interpolateQueryStr(value, variable, defaultFormatFn) {
    // if no multi or include all do not regexEscape
    if (!variable.multi && !variable.includeAll) {
      return this.escapeLiteral(value);
    }

    if (typeof value === 'string') {
      return this.quoteLiteral(value);
    }

    const escapedValues = _.map(value, this.quoteLiteral);
    return escapedValues.join(',');
  }

  quoteLiteral(value) {
    return "'" + String(value).replace(/'/g, "''") + "'";
  }

  escapeLiteral(value) {
    return String(value).replace(/'/g, "''");
  }

}
