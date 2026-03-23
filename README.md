# IntuiZ–Altares Connector for Dynamics 365

A web resource for Microsoft Dynamics 365 / Dataverse that lets users search the **Altares IntuiZ** company database and create or update CRM records directly from the search results.

Built with **React 18**, **Fluent UI 9**, **TypeScript**, and **Vite**.

---

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [CRM Configuration](#crm-configuration)
  - [Mapping Table (carfup\_altaresmappings)](#mapping-table-carfup_altaresmappings)
  - [Target Table Parameter](#target-table-parameter)
- [User Guide](#user-guide)
  - [Searching](#searching)
  - [Results Grid](#results-grid)
  - [Creating / Updating Records](#creating--updating-records)
- [Development](#development)
  - [Prerequisites](#prerequisites)
  - [Run Locally](#run-locally)
  - [Project Structure](#project-structure)
- [Build & Deploy](#build--deploy)
  - [Build for Production](#build-for-production)
  - [Deploy as a Dataverse Web Resource](#deploy-as-a-dataverse-web-resource)
  - [Add to a Model-Driven App](#add-to-a-model-driven-app)
- [Troubleshooting](#troubleshooting)

---

## Features

| Feature | Description |
|---|---|
| **Company Search** | Query the Altares IntuiZ REST API by company name, SIRET number, and/or city |
| **CRM Duplicate Detection** | Automatically checks if returned companies already exist in Dataverse using configurable matching fields |
| **Create / Update** | One-click creation of new records or update of existing ones, with dynamic field mapping |
| **Type-Aware Mapping** | Reads CRM attribute metadata to format values (integers, booleans, dates, decimals, etc.) before writing |
| **CRM Record Link** | Companies found in the CRM display a clickable icon that opens the record in a new window |
| **Configurable Target Table** | The Dataverse entity to write to is configurable via URL parameter — not hard-coded to `account` |
| **Pagination** | Server-side pagination of Altares results |
| **Responsive UI** | Fluent UI 9 components with sticky action bar, responsive grid, and sort-by-column |

---

## Architecture Overview

```
┌──────────────┐       ┌──────────────────┐       ┌───────────────────────┐
│  SearchForm  │──────▶│    App.tsx        │──────▶│  Altares IntuiZ API   │
│  (user input)│       │  (orchestrator)   │       │  /recherche-simple    │
└──────────────┘       └────────┬─────────┘       └───────────────────────┘
                                │
                     ┌──────────▼──────────┐
                     │  Dataverse Web API  │
                     │  /api/data/v9.2/    │
                     └─────────────────────┘
                       • checkCompaniesInCRM
                       • createAccountInCRM
                       • updateRecordInCRM
```

**Key services:**

| File | Role |
|---|---|
| `services/iwsService.ts` | Calls the Altares IntuiZ REST API and maps results to the internal `Company` type |
| `services/dataverseClient.ts` | Low-level Dataverse HTTP client with retry, timeout, and request logging |
| `services/dataverseService.ts` | High-level CRM operations (check, create, update) using the target entity set |
| `services/mappingService.ts` | Loads field mappings from the `carfup_altaresmappings` Dataverse table and builds CRM payloads |
| `services/metadataService.ts` | Fetches CRM attribute metadata (field types) so values can be formatted correctly |

---

## CRM Configuration

### Mapping Table (`carfup_altaresmappings`)

The connector reads its field-mapping configuration from a **custom Dataverse table** named **`carfup_altaresmappings`**. Each row defines how one Altares field maps to one CRM field.

| Column (Logical Name) | Type | Description |
|---|---|---|
| `carfup_fieldfrom` | String | The Altares / IWS field name (e.g. `raisonSociale`, `siret`, `ville`) |
| `carfup_fieldto` | String | The CRM logical name of the target field (e.g. `name`, `accountnumber`, `address1_city`). Leave empty to skip this field. |
| `carfup_useformatching` | Boolean | When **Yes**, this field is used for **duplicate detection** when checking if a company already exists in the CRM. All matching fields are combined with AND logic. |

> **Tip:** After changing mappings, refresh the web resource page to reload the configuration (mappings are cached per session).

#### Example Mapping Rows

| Field From | Field To | Use For Matching |
|---|---|---|
| `raisonSociale` | `name` | No |
| `siret` | `accountnumber` | Yes |
| `rue` | `address1_line1` | No |
| `codePostal` | `address1_postalcode` | No |
| `ville` | `address1_city` | No |

If no mappings are configured (or the table is empty), the connector falls back to a hard-coded mapping: `name`, `address1_line1`, `address1_postalcode`, `address1_city`, `accountnumber`.

### Target Table Parameter

By default, the connector writes to the **`accounts`** entity set. To target a different table, pass the entity set name (OData plural) via the `data` URL parameter when embedding the web resource.

**Format:**

```
?data=targettable%3D<entitySetName>
```

The value after `data=` is URL-encoded. For example, to target a custom entity `carfup_customaccounts`:

```
?data=targettable%3Dcarfup_customaccounts
```

This follows the standard Dynamics 365 pattern for [passing parameters to web resources via the `data` query string](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/sample-pass-multiple-values-web-resource-through-data-parameter).

**How it works internally:**

1. `App.tsx` reads `?data=`, decodes the value, and extracts the `targettable` key.
2. Calls `setTargetEntitySet()` to override the default entity set for all Dataverse operations.
3. Resolves the entity **logical name** (singular) via the Dataverse `EntityDefinitions` API — this is needed for attribute metadata and CRM record links.
4. If `targettable` is not provided, defaults to `accounts`.

---

## User Guide

### Searching

1. Enter at least a **Company Name** or a **SIRET** number (one of the two is required).
2. Optionally add a **City** to narrow results.
3. Choose filters: **Active Companies Only**, **Headquarters Only**, and the **Max Results** per page.
4. Click **Search Companies**.

**Search logic:**

| Fields Filled | Behavior |
|---|---|
| Company Name only | Searches by name (`qui` parameter) |
| SIRET only | Searches using the SIRET as the `qui` (name) parameter |
| Both Company Name + SIRET | Searches by name and filters by SIRET |
| + City | Narrows results to the specified city (`ou` parameter) |

Use the **Reset** button to clear all fields and results.

### Results Grid

| Column | Description |
|---|---|
| ☑ | Checkbox to select rows for CRM operations |
| View | Opens the company's website (if available) in a new tab |
| SIRET | The company's SIRET registration number |
| Company | Company name (raison sociale) |
| Address | Street address (truncated with hover tooltip) |
| Postal Code | Postal code |
| Status | **Active** (green) or **Inactive** (red) badge |
| HQ | Building icon for headquarters; branch icon for subsidiaries |
| Source | Green check = exists in CRM (click to open the record); link icon = external only |

All columns are sortable by clicking the header.

### Creating / Updating Records

1. Select one or more companies using the checkboxes.
2. Click **Add to CRM** in the action bar (sticks to the bottom of the screen when the table is taller than the viewport).
3. The connector will:
   - **Create** a new record for companies not yet in the CRM.
   - **Update** the existing record for companies already matched in the CRM.
4. A success message shows counts (e.g. "2 created, 1 updated in CRM"). Errors are displayed per-company.

---

## Development

### Prerequisites

- **Node.js** 18+ (with npm)

### Run Locally

```bash
# Clone the repository
git clone <repository-url>
cd IntuiZ-Altares_Connector

# Install dependencies
npm install

# Start development server (port 3010)
npm run dev
```

The app opens at `http://localhost:3010`. When running outside Dynamics 365, the Dataverse base URL resolves to `''` (empty string), so CRM calls will use relative paths.

### Project Structure

```
IntuiZ-Altares_Connector/
├── index.html              # HTML entry point (imports React via CDN, loads index.tsx)
├── index.tsx               # React bootstrap — mounts <App /> to #root
├── App.tsx                 # Main application component (state, orchestration, layout)
├── types.ts                # Shared TypeScript interfaces (Company, SearchFilters, etc.)
├── metadata.json           # Power Apps Code Apps metadata
├── components/
│   ├── SearchForm.tsx      # Search criteria form (company name, SIRET, city, filters)
│   ├── ResultsGrid.tsx     # Data table with sorting, selection, pagination, sticky footer
│   └── Icons.tsx           # Re-exports of Fluent UI icons used across components
├── services/
│   ├── iwsService.ts       # Altares IntuiZ REST API client (recherche-simple)
│   ├── dataverseClient.ts  # Low-level Dataverse HTTP client (GET/POST/PATCH/Batch)
│   ├── dataverseService.ts # High-level CRM operations (check, create, update)
│   ├── mappingService.ts   # Loads carfup_altaresmappings table, builds CRM payloads
│   ├── metadataService.ts  # Loads CRM attribute metadata for type-aware formatting
│   └── mockData.ts         # Mock company data for local development
├── utils/
│   └── logger.ts           # Categorized logger (debug/info/warn/error)
├── package.json            # Dependencies & scripts
├── tsconfig.json           # TypeScript configuration
└── vite.config.ts          # Vite build configuration (port 3010, path alias @/*)
```

---

## Build & Deploy

### Build for Production

```bash
npm run build
```

This generates optimized output in the `dist/` folder:

| File | Description |
|---|---|
| `dist/index.html` | HTML entry point |
| `dist/assets/index-*.js` | Bundled JavaScript (React + Fluent UI + app code) |

### Deploy as a Dataverse Web Resource

1. Go to [make.powerapps.com](https://make.powerapps.com/) → select your environment.
2. Navigate to **Solutions** → open your solution (or create one).
3. Click **+ New** → **More** → **Web resource**.
4. Upload each file from `dist/`:

   | File | Display Name | Type |
   |---|---|---|
   | `dist/index.html` | `<prefix>_altaresconnector.html` | Web Page (HTML) |
   | `dist/assets/index-*.js` | `<prefix>_altaresconnector.js` | Script (JS) |

5. **Important:** Open `index.html` before uploading and update the `<script>` tag `src` attribute to point to the web resource path of the JS file:
   ```html
   <script type="module" src="/<prefix>_altaresconnector.js"></script>
   ```
6. Click **Save** then **Publish All Customizations**.

> **Note:** You may also need to add a reference to the Dynamics 365 global context script in `index.html` if it is not already present:
> ```html
> <script src="../ClientGlobalContext.js.aspx"></script>
> ```
> This provides the `GetGlobalContext()` function used to resolve the org base URL.

### Add to a Model-Driven App

1. Open your **Model-Driven App** in the App Designer.
2. Add a new **Page** or **Subarea**.
3. Configure:
   - **Content Type:** Web Resource
   - **Web Resource:** select `<prefix>_altaresconnector.html`
4. To target a specific entity, set the **Custom Parameter (data)** field of the web resource properties to:
   ```
   targettable=carfup_customaccounts
   ```
   Dynamics 365 will URL-encode this and pass it as `?data=targettable%3Dcarfup_customaccounts`.
5. **Save and Publish** the app.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| **"Could not load Altares→CRM mappings"** | Verify the `carfup_altaresmappings` table exists and has active rows (`statecode = 0`). Check the browser console for the full error. |
| **"Could not resolve D365 base URL"** | The app is running outside Dynamics 365 or `ClientGlobalContext.js.aspx` is not loaded. Ensure the script reference is in `index.html`. |
| **Search returns no results** | Verify at least Company Name or SIRET is filled. Check the browser console for IWS API errors (authentication, network). |
| **Records are created with missing fields** | Check the mapping table — ensure `carfup_fieldto` is set for each field you want to populate. Verify the Altares field names in `carfup_fieldfrom` match the raw API response. |
| **"Some records failed"** | Expand the error message — it lists failures per company. Common causes: required fields missing, invalid field values, insufficient CRM privileges. |
| **CRM link opens wrong entity** | Verify the `targettable` parameter matches the entity set name (OData plural). The connector resolves the entity logical name from `EntityDefinitions`. |
| **Build warnings about chunk size** | The bundle includes Fluent UI (~550 KB). This is expected for a single-page web resource and has no functional impact. |
