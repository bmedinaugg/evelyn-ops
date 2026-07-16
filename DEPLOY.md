# Deploying Evelyn Ops to Azure

Target: **Azure Container Apps** (managed, scales, simple HTTPS ingress). The
image is built **in the cloud** with `az acr build`, so you don't need Docker
installed locally.

The app is a standard containerized Next.js server (`output: "standalone"`,
listens on port **3000**). Secrets are injected at runtime — never baked into
the image.

## 0. Prerequisites
```bash
az login
az account set --subscription "<your-subscription>"
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
```

## 1. Set variables
```bash
RG=evelyn-ops-rg
LOC=westeurope
ACR=evelynopsacr$RANDOM          # must be globally unique, lowercase/numbers
APP=evelyn-ops
ENVI=evelyn-ops-env

# Supabase (from Project Settings > API)
SUPABASE_URL=https://rxnryvwpkdnwkpmhiiup.supabase.co
ANON_KEY='<paste anon/public key>'
SERVICE_KEY='<paste service_role secret>'
```

## 2. Create the registry + build the image (cloud build)
```bash
az group create -n $RG -l $LOC
az acr create -n $ACR -g $RG --sku Basic --admin-enabled true

# builds from the Dockerfile in this directory, in Azure — no local Docker
az acr build -r $ACR -t evelyn-ops:latest .
```

## 3. Create the Container Apps environment + app
```bash
az containerapp env create -n $ENVI -g $RG -l $LOC

ACR_PW=$(az acr credential show -n $ACR --query "passwords[0].value" -o tsv)

az containerapp create \
  -n $APP -g $RG --environment $ENVI \
  --image $ACR.azurecr.io/evelyn-ops:latest \
  --registry-server $ACR.azurecr.io \
  --registry-username $ACR \
  --registry-password "$ACR_PW" \
  --target-port 3000 --ingress external \
  --min-replicas 1 --max-replicas 3 \
  --secrets "service-key=$SERVICE_KEY" "anon-key=$ANON_KEY" \
  --env-vars \
    "SUPABASE_URL=$SUPABASE_URL" \
    "SUPABASE_ANON_KEY=secretref:anon-key" \
    "SUPABASE_SERVICE_ROLE_KEY=secretref:service-key" \
    "STAFF_EMAIL_DOMAIN=urbangymgroup.com"
```

Get the public URL:
```bash
az containerapp show -n $APP -g $RG \
  --query properties.configuration.ingress.fqdn -o tsv
# -> e.g. evelyn-ops.<hash>.westeurope.azurecontainerapps.io
```

## 4. Point Supabase auth at the deployed URL
In Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://<fqdn>`
- **Redirect URLs:** add `https://<fqdn>/auth/callback`

(The Microsoft SSO app registration doesn't change — its redirect stays the
Supabase callback `https://rxnryvwpkdnwkpmhiiup.supabase.co/auth/v1/callback`.)

## 5. Done
Visit `https://<fqdn>`, sign in with Microsoft. The app derives its own origin
from the request, so the SSO round-trip works with no extra config.

## Redeploys
```bash
az acr build -r $ACR -t evelyn-ops:latest .
az containerapp update -n $APP -g $RG --image $ACR.azurecr.io/evelyn-ops:latest
```

## Restricting to specific staff
Set an explicit allow-list instead of the whole domain:
```bash
az containerapp update -n $APP -g $RG \
  --set-env-vars "STAFF_ALLOWLIST=a@urbangymgroup.com,b@urbangymgroup.com"
```

---

# Option B: CI/CD via GitHub Actions (recommended once live)

Auto-build + deploy on every push to `main`. Workflow: `.github/workflows/deploy.yml`.

### 1. One-time: provision the resources
Run **Option A steps 1–4 once** so the ACR + Container App exist (the pipeline
only rebuilds/updates them). Also do step 4 (Supabase redirect URL) once.

### 2. Push the code to GitHub
```bash
git remote add origin https://github.com/<org>/evelyn-ops.git
git push -u origin main
```

### 3. Give GitHub permission to deploy to Azure
Create a service principal scoped to the resource group, and copy the JSON:
```bash
SUB=$(az account show --query id -o tsv)
az ad sp create-for-rbac \
  --name evelyn-ops-ci \
  --role contributor \
  --scopes /subscriptions/$SUB/resourceGroups/$RG \
  --json-auth
```

### 4. Add repo Secrets + Variables (GitHub → Settings → Secrets and variables → Actions)
**Secret:**
- `AZURE_CREDENTIALS` = the full JSON from step 3

**Variables:**
- `AZURE_RESOURCE_GROUP` = `evelyn-ops-rg`
- `AZURE_ACR_NAME` = your ACR name
- `AZURE_APP_NAME` = `evelyn-ops`

### 5. Deploy
Push to `main` (or run the workflow manually via "Run workflow"). It builds the
image in ACR and rolls it out. App settings/secrets in Azure are untouched by
deploys — you set those once at provisioning.

> More secure alternative to the SP secret: **OIDC federated credentials**
> (no stored password). Swap the `azure/login` step to use
> `client-id`/`tenant-id`/`subscription-id` and add a federated credential on
> the app registration for `repo:<org>/<repo>:ref:refs/heads/main`.

---

## Notes
- **Lock ACR down later:** admin creds are used here for simplicity; switch to a
  managed identity pull once it's running (`az containerapp registry set` with
  `--identity`).
- **Custom domain / TLS:** add via `az containerapp hostname add` + managed
  certificate when you want a branded URL.
- Alternative host: the same image runs on **App Service for Containers** — set
  `WEBSITES_PORT=3000` and the same env vars.
