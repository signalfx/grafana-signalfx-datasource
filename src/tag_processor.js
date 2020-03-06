// Copyright (C) 2020 Splunk, Inc. All rights reserved.
import _ from "lodash";

export class TagProcessor {

    constructor(templateSrv) {
        this.templateSrv = templateSrv;
    }

    timeSeriesNameAndId(tsId, tags, aliases) {
        if (!tags) {
            return { id: tsId, name: tsId };
        }

        const candidates = ['sf_metric', 'sf_originatingMetric'];
        const excludedDimensions = ['sf_metric', 'sf_originatingMetric', 'jobId', 'programId', 'computationId'];

        const tsVars = {};
        const metricWithDims = [];
        for (let c in candidates) {
            const value = tags[candidates[c]];
            if (value && !value.toLowerCase().startsWith('_sf_')) {
                tsVars['metric'] = { text: value, value: value };
                metricWithDims.push(value);
            }
        }

        const key = [];
        for (let k in tags['sf_key']) {
            const dimension = tags['sf_key'][k];
            if (excludedDimensions.indexOf(dimension) === -1) {
                const value = tags[dimension];
                if (value) {
                    key.push(dimension + '=' + value);
                }
            }
        }

        metricWithDims.push(key.join(','));

        for (let k in tags) {
            if (excludedDimensions.indexOf(k) === -1) {
                const value = tags[k];
                if (value) {
                    tsVars[k] = { text: value, value: value };
                }
            }
        }

        let label = '';
        let alias = null;
        const streamLabel = tags['sf_streamLabel'];
        if (streamLabel) {
            tsVars['label'] = { text: streamLabel, value: streamLabel };
            label = streamLabel + ':';
            alias = aliases[streamLabel];
        } else {
            alias = _.find(aliases, a => true);
        }
        const id = label + metricWithDims.join('/');
        const name = alias ? this.templateSrv.replace(alias, tsVars) : id;
        return { id, name };
    }

}