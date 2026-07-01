variable "project_name" {
  type = string
}

variable "instance_type" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "security_group_id" {
  type = string
}

variable "key_name" {
  type = string
}

variable "login_user" {
  type = string
}

variable "login_password" {
  type      = string
  sensitive = true
}

variable "vnc_password" {
  type      = string
  sensitive = true
}
