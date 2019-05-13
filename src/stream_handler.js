// Copyright (C) 2019 SignalFx, Inc. All rights reserved.
import _ from "lodash";
import moment from 'moment';

function defer() {
  var res, rej;

  var promise = new Promise((resolve, reject) => {
    res = resolve;
    rej = reject;
  });

  promise.resolve = res;
  promise.reject = rej;

  return promise;
}

const MAX_DATAPOINTS_TO_KEEP_BEFORE_TIMERANGE = 1;
const INACTIVE_JOB_MINUTES = 6;
const STREAMING_THRESHOLD_MINUTES = 2;

export class StreamHandler {

  constructor(signalflow, templateSrv) {
    this.signalflow = signalflow;
    this.templateSrv = templateSrv;
  }

  start(program, aliases, options) {
    if (this.isJobReusable(program, options)) {
      if (!this.unboundedBatchPhase) {
        this.promise = defer();
        this.initializeTimeRange(options);
        this.flushData();
      }
    } else {
      this.promise = defer();
      this.stop();
      this.execute(program, aliases, options);
    }
    return this.promise;
  }

  isJobReusable(program, options) {
    return this.handle
      && this.program == program
      && this.intervalMs == options.intervalMs
      && ((this.unbounded && this.startTime <= options.range.from.valueOf())
        || (this.startTime <= options.range.from.valueOf() && this.stopTime >= options.range.to.valueOf()));
  }

  stop() {
    if (this.handle) {
      console.debug('Stopping SignalFlow computation.');
      this.handle.close();
      this.handle = null;
    }
  }

  execute(program, aliases, options) {
    console.log('Starting SignalFlow computation: ' + program);
    this.initialize(program, aliases, options);
    var params = {
      program: this.program,
      start: this.startTime,
      resolution: this.intervalMs,
    };
    if (!this.unbounded) {
      params['stop'] = this.stopTime;
      params['immediate'] = true;
    }
    this.handle = this.signalflow.execute(params);
    this.handle.stream(this.handleData.bind(this));
    if (this.jobStartTimeout) {
      clearTimeout(this.jobStartTimeout);
    }
    this.jobStartTimeout = setTimeout(() => {
      console.debug('Job inactive for ' + INACTIVE_JOB_MINUTES + ' minutes: ' + program);
      this.stop();
    }, INACTIVE_JOB_MINUTES * 60 * 1000);
  }

  initialize(program, aliases, options) {
    this.metrics = {};
    this.program = program;
    this.aliases = aliases;
    this.initializeTimeRange(options);
    this.intervalMs = options.intervalMs;
    this.maxDataPoints = options.maxDataPoints;
    this.resolutionMs = options.intervalMs;
    this.maxDelay = 0;
    this.unbounded = this.stopTime > Date.now() - STREAMING_THRESHOLD_MINUTES * 60 * 1000;
    this.unboundedBatchPhase = this.unbounded;
  }

  initializeTimeRange(options) {
    this.startTime = options.range.from.valueOf();
    this.stopTime = options.range.to.valueOf();
    this.cutoffTime = Math.min(Date.now(), this.stopTime);
  }

  handleData(err, data) {
    if (err) {
      console.debug('Stream error', err);
      this.stop();
      this.promise.reject(err.message);
      return;
    }

    if (data.type === 'message' && data.message.messageCode === 'JOB_RUNNING_RESOLUTION') {
      this.resolutionMs = data.message.contents.resolutionMs;
    }

    if (data.type === 'message' && data.message.messageCode === 'JOB_INITIAL_MAX_DELAY') {
      this.maxDelay = data.message.contents.maxDelayMs;
    }

    if (data.type === 'control-message' && data.event === 'END_OF_CHANNEL') {
      this.flushData();
    }

    if (data.type !== 'data') {
      console.debug(data);
      return;
    }

    if (this.appendData(data) && this.unboundedBatchPhase) {
      // Do not flush immediately as some more data may be still received
      if (this.batchPhaseFlushTimeout) {
        clearTimeout(this.batchPhaseFlushTimeout);
      }
      this.batchPhaseFlushTimeout = setTimeout(() => this.flushData(), 500);
    }
  }

  appendData(data) {
    for (var i = 0; i < data.data.length; i++) {
      var point = data.data[i];
      var datapoints = this.metrics[point.tsId];
      if (!datapoints) {
        datapoints = [];
        this.metrics[point.tsId] = datapoints;
      }
      datapoints.push([point.value, data.logicalTimestampMs]);
    }
    // Estimate an align timestamps to boundaries based on resolution
    var nextEstimatedTimestamp = data.logicalTimestampMs + (Math.ceil(this.maxDelay / this.resolutionMs) + 1) * this.resolutionMs;
    return nextEstimatedTimestamp >= Math.floor(this.cutoffTime / this.resolutionMs) * this.resolutionMs;
  }

  flushData() {
    this.unboundedBatchPhase = false;
    var seriesList = [];
    var minTime = 0;
    var maxTime = 0;
    var timeRangeStart = this.startTime - MAX_DATAPOINTS_TO_KEEP_BEFORE_TIMERANGE * this.resolutionMs;
    for (var tsId in this.metrics) {
      var datapoints = this.metrics[tsId];
      while (datapoints.length > 0 && timeRangeStart > datapoints[0][1]) {
        datapoints.shift();
      }
      if (datapoints.length > 0) {
        if (minTime == 0 || minTime > datapoints[0][1]) {
          minTime = datapoints[0][1];
        }
        if (maxTime == 0 || maxTime < datapoints[datapoints.length - 1][1]) {
          maxTime = datapoints[datapoints.length - 1][1];
        }
      }
      var tsName = this.getTimeSeriesName(tsId);
      seriesList.push({ target: tsName.name, id: tsName.id, datapoints: datapoints.slice() });
    }
    // Ensure consistent TS order
    seriesList.sort((a, b) => a.id.localeCompare(b.id));
    var data = {
      data: seriesList,
      range: { from: moment(minTime), to: moment(maxTime) },
    };
    this.promise.resolve(data);
    console.debug('Data returned: ' + this.program);
  }

  getTimeSeriesName(tsId) {
    var obj = this.handle.get_metadata(tsId);
    if (!obj) {
      return tsId;
    }

    var candidates = ['sf_metric', 'sf_originatingMetric'];
    var excludedDimensions = ['sf_metric', 'sf_originatingMetric', 'jobId', 'programId', 'computationId'];

    var tsVars = {};
    var result = [];
    for (var c in candidates) {
      var value = obj.properties[candidates[c]];
      if (value && !value.toLowerCase().startsWith('_sf_')) {
        tsVars['metric'] = { text: value, value: value };
        result.push(value);
      }
    }

    var key = [];
    for (var k in obj.properties['sf_key']) {
      var dimension = obj.properties['sf_key'][k];
      if (excludedDimensions.indexOf(dimension) === -1) {
        var value = obj.properties[dimension];
        if (value) {
          key.push(dimension + '=' + value);
          tsVars[dimension] = { text: value, value: value };
        }
      }
    }

    result.push(key.join(','));

    var repr = '';
    var alias = null;
    if (obj.properties['sf_streamLabel']) {
      tsVars['label'] = { text: obj.properties['sf_streamLabel'], value: obj.properties['sf_streamLabel'] };
      repr += obj.properties['sf_streamLabel'] + ':';
      alias = this.aliases[obj.properties['sf_streamLabel']];
    } else {
      alias = _.find(this.aliases, a => true);
    }
    var id = repr + result.join('/');
    var name = alias ? this.templateSrv.replace(alias, tsVars) : id;
    return { id, name };
  }
}
