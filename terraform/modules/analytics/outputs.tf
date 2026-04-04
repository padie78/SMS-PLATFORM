output "grafana_url" {
  value       = "http://${aws_instance.grafana_server.public_ip}:3000"
  description = "URL para acceder al dashboard de Grafana"
}

output "instance_id" {
  value = aws_instance.grafana_server.id
}