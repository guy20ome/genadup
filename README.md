# genadup

Guided automation for replacing Geneanet linked-tree references with real people in your own tree, using Geneanet's own **Importer dans mon arbre** workflow.

The first version is intentionally review-first:

- It recursively discovers ancestors from the external Geneanet tree.
- It opens Geneanet's import UI for each ancestor when available.
- You review and validate the import in Geneanet.
- It writes a CSV report after every step.

This avoids silent bulk edits to your tree while still removing most of the repetitive navigation.

## Option A: Userscript, No Node Needed

This is the easiest way to use `genadup`.

1. Install a userscript extension such as Tampermonkey or Violentmonkey.
2. Add [userscripts/genadup.user.js](userscripts/genadup.user.js) as a new userscript.
3. Open the linked-tree profile:

```text
https://gw.geneanet.org/
```

4. Click **Start/reset here** in the `genadup` panel.
5. For each profile, click **Open import**, validate Geneanet's import screen, then click **Done + next**.

The userscript stores the queue in your browser's `localStorage` for `gw.geneanet.org`.

## Option B: Playwright Script

Use this if you prefer running the flow from a terminal.

## Setup

```powershell
npm install
```

If Playwright asks for a browser install, you can use the installed Microsoft Edge channel by default. The script keeps its own local browser profile in `.genadup-browser-profile`, so you only need to log into Geneanet once inside the browser window it opens.

## Discover Ancestors Only

Use this first to check what the external tree exposes:

```powershell
npm run discover -- --start "https://gw.geneanet.org/gntstarnivatanne?lang=fr&n=sgard&oc=0&p=adele+felicie+sidonie&type=tree" --generations all
```

The report is written under `reports/`.

## Guided Import

```powershell
npm run guided -- --start "https://gw.geneanet.org/gntstarnivatanne?lang=fr&n=sgard&oc=0&p=adele+felicie+sidonie&type=tree" --my "https://gw.geneanet.org/gnivat_w?lang=fr&n=sgard&oc=1&p=adele+felicie+sidonie&type=tree" --generations all
```

For each person:

1. The script opens the external Geneanet profile.
2. It collects that person's parents.
3. It tries to open **Plus** -> **Importer dans mon arbre**.
4. You review and validate in Geneanet.
5. Press Enter in the terminal to continue.

Type `s` then Enter to skip a person, or `q` then Enter to stop.

## Useful Options

```powershell
--generations 2
```

Limit the run to parents and grandparents for a first test.

```powershell
--profile ".genadup-browser-profile"
```

Choose the local browser profile folder.

```powershell
--browserChannel chrome
```

Use a different installed browser channel. The default is `msedge`.

## Notes

Geneanet's import UI decides what data can be imported. This script does not scrape private data, bypass Geneanet permissions, or submit final changes without you validating the Geneanet screen.
