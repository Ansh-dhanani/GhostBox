terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

module "networking" {
  source = "./modules/networking"

  project_name = var.project_name
  vpc_cidr     = var.vpc_cidr
}

module "security" {
  source = "./modules/security"

  project_name  = var.project_name
  vpc_id        = module.networking.vpc_id
  your_ip_cidr  = var.your_ip_cidr
}

module "ec2" {
  source = "./modules/ec2"

  project_name      = var.project_name
  instance_type     = var.instance_type
  subnet_id         = module.networking.public_subnet_id
  security_group_id = module.security.security_group_id
  key_name          = var.key_name
  login_user        = var.login_user
  login_password    = var.login_password
  vnc_password      = var.vnc_password
}
