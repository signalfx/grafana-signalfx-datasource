// Copyright (C) 2019-2020 Splunk, Inc. All rights reserved.
import _ from "lodash";
import { TagProcessor } from './tag_processor';
import moment from 'moment';

function defer() {
    let res, rej;

    let promise = new Promise((resolve, reject) => {
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
        this.tagProcessor = new TagProcessor(templateSrv);
    }

    start(program, aliases, maxDelay, options) {
        this.aliases = aliases;
        if (this.isJobReusable(program, maxDelay, options)) {
            if (!this.unboundedBatchPhase) {
                this.promise = defer();
                this.initializeTimeRange(options);
                this.flushData();
            }
        } else {
            this.promise = defer();
            this.stop();
            this.execute(program, maxDelay, options);
        }
        this.setupCleanupTask();
        return this.promise;
    }

    isJobReusable(program, maxDelay, options) {
        return this.program == program
            && this.desiredMaxDelay == maxDelay
            && this.intervalMs == options.intervalMs
            && this.startTime <= options.range.from.valueOf()
            && ((this.unbounded && this.running) || this.stopTime >= options.range.to.valueOf());
    }

    setupCleanupTask() {
        if (this.jobStartTimeout) {
            clearTimeout(this.jobStartTimeout);
        }
        this.jobStartTimeout = setTimeout(() => {
            console.debug('Job inactive for ' + INACTIVE_JOB_MINUTES + ' minutes: ' + this.program);
            this.stop();
        }, INACTIVE_JOB_MINUTES * 60 * 1000);
    }

    stop() {
        if (this.running) {
            console.debug('Stopping SignalFlow computation.');
            this.handle.close();
            this.running = false;
        }
    }

    execute(program, maxDelay, options) {
        console.log('Starting SignalFlow computation: ' + program);
        this.initialize(program, maxDelay, options);
        const params = {
            program: this.program,
            start: this.startTime,
            resolution: this.intervalMs,
        };
        if (!this.unbounded) {
            params['stop'] = this.stopTime;
            params['immediate'] = true;
        }
        if (this.maxDelay) {
            params['maxDelay'] = this.maxDelay;
        }
        this.handle = this.signalflow.execute(params);
        this.running = true;
        this.handle.stream(this.handleData.bind(this));
    }

    initialize(program, maxDelay, options) {
        this.metrics = {};
        this.program = program;
        this.maxDelay = maxDelay;
        this.desiredMaxDelay = maxDelay;
        this.initializeTimeRange(options);
        this.intervalMs = options.intervalMs;
        this.maxDataPoints = options.maxDataPoints;
        this.resolutionMs = options.intervalMs;
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

        if (data.type === 'control-message' && (data.event === 'END_OF_CHANNEL' || data.event === 'CHANNEL_ABORT')) {
            this.flushData();
            this.stop();
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
        for (let i = 0; i < data.data.length; i++) {
            const point = data.data[i];
            let datapoints = this.metrics[point.tsId];
            if (!datapoints) {
                datapoints = [];
                this.metrics[point.tsId] = datapoints;
            }
            datapoints.push([point.value, data.logicalTimestampMs]);
        }
        // Estimate an align timestamps to boundaries based on resolution
        const nextEstimatedTimestamp = data.logicalTimestampMs + Math.ceil(this.maxDelay / this.resolutionMs + 1) * this.resolutionMs;
        return nextEstimatedTimestamp > Math.floor(this.cutoffTime / this.resolutionMs) * this.resolutionMs;
    }

    flushData() {
        this.unboundedBatchPhase = false;
        const seriesList = [];
        let minTime = 0;
        let maxTime = 0;
        const timeRangeStart = this.startTime - MAX_DATAPOINTS_TO_KEEP_BEFORE_TIMERANGE * this.resolutionMs;
        for (let tsId in this.metrics) {
            const datapoints = this.metrics[tsId];
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
            const tsName = this.tagProcessor.timeSeriesNameAndId(tsId, this.handle.get_metadata(tsId).properties, this.aliases);
            seriesList.push({ target: tsName.name, id: tsName.id, datapoints: datapoints.slice() });
        }
        // Ensure consistent TS order
        seriesList.sort((a, b) => a.id.localeCompare(b.id));
        const data = {
            data: seriesList,
            range: { from: moment(minTime), to: moment(maxTime) },
        };
        this.promise.resolve(data);
        console.debug('Data returned: ' + this.program);
    }

}
