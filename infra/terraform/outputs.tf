output "instance_public_ip" {
  description = "Public IP of your GhostBox instance"
  value       = module.ec2.public_ip
}

output "ghostbox_url" {
  description = "Open this in your browser"
  value       = "http://${module.ec2.public_ip}"
}

output "ssh_command" {
  description = "SSH into the instance"
  value       = "ssh -i ~/.ssh/${var.key_name}.pem ubuntu@${module.ec2.public_ip}"
}

output "setup_log" {
  description = "Tail this to watch the user data script progress"
  value       = "ssh -i ~/.ssh/${var.key_name}.pem ubuntu@${module.ec2.public_ip} 'tail -f /var/log/ghostbox-setup.log'"
}
