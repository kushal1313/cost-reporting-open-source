import { awsConnector } from "@cost-reporting/connector-aws";
import { ConnectorRegistry } from "@cost-reporting/connector-core";
import { datadogConnector } from "@cost-reporting/connector-datadog";
import { grafanaCloudConnector } from "@cost-reporting/connector-grafana-cloud";

export const connectorRegistry = new ConnectorRegistry();
connectorRegistry.register(awsConnector);
connectorRegistry.register(datadogConnector);
connectorRegistry.register(grafanaCloudConnector);
