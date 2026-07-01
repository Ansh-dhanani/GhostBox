output "public_ip" {
  value = aws_eip.ghostbox.public_ip
}

output "instance_id" {
  value = aws_instance.ghostbox.id
}
