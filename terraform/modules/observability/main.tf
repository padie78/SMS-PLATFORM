# CloudWatch metric filters + alarmas invoice onboarding

resource "aws_cloudwatch_log_metric_filter" "invoice_state_transition" {
  count = var.worker_log_group_name != "" ? 1 : 0

  name           = "${var.project_name}-invoice-state-transition-${var.environment}"
  log_group_name = var.worker_log_group_name
  pattern        = "{ $.message = \"STATE_TRANSITION\" || $.state = * }"

  metric_transformation {
    name      = "InvoiceStateTransitionCount"
    namespace = "SMS/InvoiceOnboarding"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "invoice_ocr_latency" {
  count = var.worker_log_group_name != "" ? 1 : 0

  name           = "${var.project_name}-invoice-ocr-latency-${var.environment}"
  log_group_name = var.worker_log_group_name
  pattern        = "{ $.latencyMs = * && $.message = *OCR* }"

  metric_transformation {
    name      = "InvoiceOcrLatencyMs"
    namespace = "SMS/InvoiceOnboarding"
    value     = "$.latencyMs"
  }
}

resource "aws_cloudwatch_metric_alarm" "invoice_dlq_visible" {
  count = var.dlq_queue_name != "" ? 1 : 0

  alarm_name          = "${var.project_name}-invoice-dlq-messages-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "Invoice processing DLQ has visible messages"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = var.dlq_queue_name
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_lambda_errors" {
  count = var.worker_lambda_name != "" ? 1 : 0

  alarm_name          = "${var.project_name}-worker-errors-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Worker lambda errors detected"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = var.worker_lambda_name
  }
}
