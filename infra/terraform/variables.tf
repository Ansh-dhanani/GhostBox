variable "project_name" {
  description = "Name prefix for all resources"
  type        = string
  default     = "ghostbox"
}

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "ap-south-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "your_ip_cidr" {
  description = "Your public IP in CIDR notation (e.g. 1.2.3.4/32). Only this IP can SSH in."
  type        = string

  validation {
    condition     = can(cidrhost(var.your_ip_cidr, 0))
    error_message = "your_ip_cidr must be valid CIDR notation, for example 1.2.3.4/32."
  }
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t2.micro"
}

variable "key_name" {
  description = "Name of your existing AWS EC2 key pair for SSH access"
  type        = string
}

variable "login_user" {
  description = "Username for the GhostBox web login page"
  type        = string
  default     = "ansh"
}

variable "login_password" {
  description = "Password for the GhostBox web login page"
  type        = string
  sensitive   = true
}

variable "vnc_password" {
  description = "VNC server password (6 to 8 chars)"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.vnc_password) >= 6 && length(var.vnc_password) <= 8
    error_message = "vnc_password must be 6 to 8 characters because VNC truncates passwords after 8 characters."
  }
}
