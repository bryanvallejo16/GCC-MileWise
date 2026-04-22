# Deploying to Rahti (CSC's OpenShift / OKD 4.19)

End-to-end instructions for getting the static map running on Rahti 2
using the `oc` CLI. The web console works too — the steps map 1:1.

## Prerequisites

- A CSC project with **Rahti 2** enabled (apply via https://my.csc.fi if
  you haven't).
- The `oc` CLI installed locally. Download from your Rahti console
  (top-right dropdown → "Command line tools"), or:
  - macOS: `brew install openshift-cli`
  - Windows: scoop/choco or download binary from OpenShift docs
- Docker or Podman locally to build the image.
- This project folder, already containing a fresh
  `output/routing_map.html` (re-run `python run_routing.py` if needed).

## 0. Make sure the HTML is up to date

```bash
python run_routing.py
# Verify it produced output/routing_map.html
ls -lh output/routing_map.html
```

## 1. Log in to Rahti

1. Open the Rahti web console: https://rahti.csc.fi/ (it will redirect
   you to the correct Rahti 2 URL).
2. Top-right → your name → **Copy login command** → **Display Token**.
3. Paste the `oc login ...` command into your terminal.

Verify:

```bash
oc whoami
oc projects
```

## 2. Create a project (namespace)

Pick a short, lowercase project name:

```bash
oc new-project ev-routing-rovaniemi --display-name="EV Routing — Rovaniemi"
```

If your CSC project already has a namespace set up for you, switch to it
instead:

```bash
oc project YOUR_EXISTING_NAMESPACE
```

## 3. Build the image inside Rahti (easiest path — no local Docker needed)

Rahti can build from your local source using OpenShift's built-in BuildConfig.
From the project root (where the `Dockerfile` lives):

```bash
oc new-build --strategy=docker --binary --name=ev-routing-map
oc start-build ev-routing-map --from-dir=. --follow
```

This uploads the folder, builds the image inside Rahti, and pushes it to
the internal registry as `image-registry.openshift-image-registry.svc:5000/<namespace>/ev-routing-map:latest`.

### Alternative: build locally and push

If you prefer to build locally and push to Rahti's registry:

```bash
# Log into the Rahti registry with your OpenShift token
docker login -u $(oc whoami) -p $(oc whoami -t) image-registry.apps.2.rahti.csc.fi

docker build -t image-registry.apps.2.rahti.csc.fi/<namespace>/ev-routing-map:latest .
docker push image-registry.apps.2.rahti.csc.fi/<namespace>/ev-routing-map:latest
```

(Replace `<namespace>` with `ev-routing-rovaniemi` or whatever you used.)

## 4. Create the Deployment + Service

```bash
oc new-app ev-routing-map --name=ev-routing-map
```

This creates a Deployment pulling the image and a Service exposing port
8080 inside the cluster.

Check it's running:

```bash
oc get pods -w
# wait until STATUS is Running
```

## 5. Expose the app to the public internet

```bash
oc create route edge ev-routing-map \
  --service=ev-routing-map \
  --port=8080 \
  --insecure-policy=Redirect
```

`edge` means Rahti terminates TLS for you — your site is HTTPS automatically.

Get the URL:

```bash
oc get route ev-routing-map -o jsonpath='{"https://"}{.spec.host}{"\n"}'
```

Open that URL in a browser. The map should load.

## 6. Updating the site

Every time you regenerate `output/routing_map.html`, just rebuild:

```bash
python run_routing.py
oc start-build ev-routing-map --from-dir=. --follow
# Rahti will auto-deploy the new image
```

If auto-rollout doesn't trigger, force it:

```bash
oc rollout restart deployment/ev-routing-map
```

## Troubleshooting

### Pod crashes with "bind() to 0.0.0.0:80 failed (Permission denied)"

You're using the stock `nginx` image instead of `nginx-unprivileged`.
Make sure the `Dockerfile` starts with
`FROM nginxinc/nginx-unprivileged:...`. OpenShift refuses privileged
ports (<1024) by default.

### Pod crashes with "open() /var/cache/nginx/.../... failed"

Random-UID issue. Same fix as above — use `nginx-unprivileged`, which
puts all writable paths under `/tmp` and `/var/lib/nginx` with correct
permissions.

### Build fails: "no such file or directory: output/routing_map.html"

You haven't generated the HTML yet. Run `python run_routing.py` first.
Verify `output/routing_map.html` exists before running `oc start-build`.

### Route shows a "Application is not available" OpenShift page

The pod isn't Ready yet. Check:

```bash
oc get pods
oc logs deployment/ev-routing-map
oc describe route ev-routing-map
```

Wait for the pod to be `Running` with `1/1` ready.

### Image too large

The image should be ~30 MB (nginx alpine + 2 MB HTML). If it's
significantly larger, check `.dockerignore` — you might be shipping
the `data/` folder or a `.venv`.

## Optional: automate via GitHub Actions

Commit this repo to GitHub, then add a secret `RAHTI_TOKEN` (your
`oc whoami -t`) and a workflow `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Rahti
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r requirements.txt
      - run: python run_routing.py
      - uses: redhat-actions/oc-login@v1
        with:
          openshift_server_url: https://api.2.rahti.csc.fi:6443
          openshift_token: ${{ secrets.RAHTI_TOKEN }}
          namespace: ev-routing-rovaniemi
      - run: oc start-build ev-routing-map --from-dir=. --follow
```

Push to `main` → Rahti rebuilds and rolls out automatically.
