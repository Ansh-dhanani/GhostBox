# GhostBox

Private web gateway to a remote Linux machine — browser terminal + XFCE desktop on EC2, with full local development support.

## Quickstart

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 — enter the secret key (default: `ghostbox`) and the terminal is ready.

## How it works

| | Local dev | EC2 (production) |
|---|---|---|
| **Auth** | Secret key via login page | Nginx + HMAC session cookies |
| **Terminal** | Built-in Node.js WebSocket server (no external deps) | ttyd proxied through Nginx |
| **Desktop** | Not available (placeholder explains why) | VNC + noVNC proxied through Nginx |
| **App** | Next.js dev server on :3000 | Static export served by Nginx |

The app auto-detects the environment: on localhost it uses local auth (localStorage) and the built-in terminal server. On a public host it trusts Nginx auth and routes through proxy paths.

## Project Structure

```
apps/
  web/              Next.js 16 app (React 19, static export)
  terminal-server/  Built-in WebSocket terminal (replaces ttyd)
infra/
  terraform/        AWS free-tier provisioning (VPC, EC2, Nginx, auth)
```

## Local Development

### Commands

```bash
pnpm dev              # Start everything (terminal + Next.js)
pnpm dev:web          # Next.js only — http://localhost:3000
pnpm dev:terminal     # Terminal server only — http://127.0.0.1:7681
pnpm build:web        # Static export to apps/web/out/
pnpm setup            # Check dependencies
```

### Custom secret key

Set `NEXT_PUBLIC_GHOSTBOX_SECRET` in `apps/web/.env.local` to override the default (`ghostbox`):

```
NEXT_PUBLIC_GHOSTBOX_SECRET=my-secret
```

## Deployment (AWS EC2)

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars — fill in your IP, key name, passwords
terraform init
terraform apply
```

The EC2 instance self-configures with ttyd, VNC + noVNC, Node.js auth server, and Nginx reverse proxy.

Watch setup:

```bash
ssh -i ~/.ssh/YOUR_KEY.pem ubuntu@YOUR_IP 'tail -f /var/log/ghostbox-setup.log'
```

Open the `ghostbox_url` from Terraform output in your browser.

### Free-tier notes

- t2.micro, 20 GB gp3 root volume
- Ports 80/443 open to internet, SSH locked to your IP
- All backend services listen on localhost only
