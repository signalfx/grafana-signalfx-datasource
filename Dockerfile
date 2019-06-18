FROM ubuntu as builder

RUN apt-get update && \
    apt-get install -yq unzip curl && \
    curl -L https://github.com/signalfx/grafana-signalfx-datasource/archive/54ae9757471febd62fc18af3112921ab328cd300.zip > /tmp/grafana-signalfx-datasource.zip && \
    unzip -q /tmp/grafana-signalfx-datasource.zip -d /plugin

FROM grafana/grafana:6.2.2

ENV GF_PATHS_PLUGINS=/opt/grafana-plugins

COPY --from=builder --chown=472:472 /plugin/grafana-signalfx-datasource-54ae9757471febd62fc18af3112921ab328cd300/dist/ /opt/grafana-plugins/signalfx-datasource
