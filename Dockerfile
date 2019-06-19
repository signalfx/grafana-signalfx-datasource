FROM busybox as builder

ENV COMMIT=54ae9757471febd62fc18af3112921ab328cd300

RUN wget -O /tmp/grafana-signalfx-datasource.zip https://github.com/signalfx/grafana-signalfx-datasource/archive/$COMMIT.zip && \
    mkdir -p /plugin && \
    unzip -q /tmp/grafana-signalfx-datasource.zip -d /plugin && \
    mv /plugin/grafana-signalfx-datasource-$COMMIT /plugin/grafana-signalfx-datasource

FROM grafana/grafana:6.2.2

ENV GF_PATHS_PLUGINS=/opt/grafana-plugins

COPY --from=builder --chown=472:472 /plugin/grafana-signalfx-datasource/dist/ /opt/grafana-plugins/signalfx-datasource
