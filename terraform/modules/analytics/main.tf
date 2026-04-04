# ==============================================================================
# DATA SOURCES: Recuperamos la infraestructura default de AWS
# ==============================================================================
data "aws_vpc" "default" {
  default = true
}

# Buscamos una subnet pública en la VPC default para que la EC2 tenga salida a internet
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ==============================================================================
# SEGURIDAD: Security Group para Grafana
# ==============================================================================
resource "aws_security_group" "grafana_sg" {
  name        = "${var.project_name}-grafana-sg-${var.environment}"
  description = "Security Group para el dashboard de Grafana (Acceso restringido)"
  vpc_id      = data.aws_vpc.default.id

  # Entrada: Solo permitimos el puerto 3000 desde TU IP
  ingress {
    description      = "Acceso a Grafana UI"
    from_port        = 3000
    to_port          = 3000
    protocol         = "tcp"
    cidr_blocks      = [var.allowed_ip_network] 
  }

  # Salida: Permitimos todo para que Grafana pueda descargar actualizaciones/plugins
  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-grafana-sg"
    Environment = var.environment
  }
}

# ==============================================================================
# IDENTIDAD: IAM Role para acceso nativo a DynamoDB
# ==============================================================================
resource "aws_iam_role" "grafana_role" {
  name = "${var.project_name}-grafana-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "grafana_dynamo_policy" {
  name = "${var.project_name}-grafana-dynamo-policy"
  role = aws_iam_role.grafana_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = [
          "dynamodb:DescribeTable", 
          "dynamodb:Scan", 
          "dynamodb:Query", 
          "dynamodb:GetItem"
        ]
        Effect   = "Allow"
        Resource = [var.dynamodb_table_arn]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "grafana_profile" {
  name = "${var.project_name}-grafana-profile-${var.environment}"
  role = aws_iam_role.grafana_role.name
}

# ==============================================================================
# CÓMPUTO: Instancia EC2 (Free Tier)
# ==============================================================================
resource "aws_instance" "grafana_server" {
  ami                    = var.ami_id
  instance_type          = "t3.micro"
  
  # Usamos la primera subnet disponible de la VPC default
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.grafana_sg.id]
  iam_instance_profile   = aws_iam_instance_profile.grafana_profile.name
  
  # Importante: Asignamos IP pública para que puedas entrar desde tu casa/oficina
  associate_public_ip_address = true
  
  key_name               = var.key_name

  # Instalación automatizada de Grafana al arrancar
user_data = <<-EOF
              #!/bin/bash
              # Actualización de paquetes del sistema
              sudo yum update -y

              # 1. Descarga e instalación de Grafana v11.6.0 (Versión OSS estable)
              # Actualizamos a la 11.6.0 para aprovechar las últimas mejoras de seguridad y UI
              sudo wget https://dl.grafana.com/oss/release/grafana-11.6.0-1.x86_64.rpm
              sudo yum install -y grafana-11.6.0-1.x86_64.rpm

              # 2. Instalación del plugin Infinity
              # Vital para conectar APIs JSON/REST de forma dinámica
              sudo grafana-cli plugins install yesoreyeram-infinity-datasource

              # 3. Configuración de permisos (Opcional pero recomendado)
              # Asegura que Grafana tenga acceso a sus directorios de plugins tras la instalación
              sudo chown -R grafana:grafana /var/lib/grafana/plugins

              # 4. Habilitar e iniciar el servicio
              sudo systemctl daemon-reload
              sudo systemctl enable grafana-server
              
              # Iniciamos y reiniciamos para forzar la carga de los plugins recién instalados
              sudo systemctl start grafana-server
              sudo systemctl restart grafana-server
              EOF
              
  tags = {
    Name        = "${var.project_name}-analytics-server"
    Environment = var.environment
    Project     = var.project_name
  }
}