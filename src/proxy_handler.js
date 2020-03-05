// Copyright (C) 2020 Splunk, Inc. All rights reserved.
import _ from "lodash";
import {TagProcessor} from './tag_processor';

export class ProxyHandler {

    constructor(datasourceId, backendSrv, templateSrv) {
        this.datasourceId = datasourceId;
        this.backendSrv = backendSrv;
        this.templateSrv = templateSrv;
        this.tagProcessor = new TagProcessor(templateSrv);
    }

    start(program, aliases, maxDelay, options) {
        this.aliases = aliases;
        const refId = 'refId';
        return this.backendSrv
            .datasourceRequest({
                url: '/api/tsdb/query',
                method: 'POST',
                data: {
                    from: options.range.from.valueOf().toString(),
                    to: options.range.to.valueOf().toString(),
                    queries: [
                        {
                            refId,
                            intervalMs: options.intervalMs,
                            maxDelay,
                            maxDataPoints: options.maxDataPoints,
                            datasourceId: this.datasourceId,
                            program,
                        }]
                },
            }).then(response => {
                console.log(response);
                if (response.status === 200) {
                    const seriesList = [];
                    const r = response.data.results[refId];
                    _.forEach(r.series, s => {
                        const nameId = this.tagProcessor.timeSeriesNameAndId(s.name, this.unmarshallTags(s.tags), this.aliases);
                        seriesList.push({ target: nameId.name, datapoints: s.points, id: nameId.id });
                    });
                    seriesList.sort((a, b) => a.id.localeCompare(b.id));
                    const data = {
                        data: seriesList,
                    };
                    return data;
                }
                throw { message: 'Error ' + response.status };
            });
    }

    unmarshallTags(marshalledTags) {
        const tags = {};
        for (var k in marshalledTags) {
            const value = marshalledTags[k];
            if (value) {
                tags[k] = JSON.parse(value);
            }
        }
        return tags;
    }

}