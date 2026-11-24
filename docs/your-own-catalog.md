# Make your own catalog

[Português](your-own-catalog.pt-BR.md)

In an upcoming version, every hub will come with the official catalog, which is
this repository, and the app will accept other catalogs. To add one, whoever
administers an Organization gives three things: a name, the address of the index
and the public key of whoever publishes it. This page shows how to make one.

A catalog of your own lets a company publish its internal connections and
templates, or a community share its own. It is a copy of this repository with
another key: the same index format, the same signature and the same validator.

What the app does with the items of another catalog:

- No template from another catalog runs without an approval.
- Updating a connection that changes its address asks for a confirmation, and
  every person connects again.
- Only the same key updates what is already installed.
- In a template from another catalog, the read tools of the steps come empty, and
  the person turns on the ones they want. The agent of a step is always the one of
  the Organization.
- The id of a connection type the official catalog publishes belongs to it: the
  app does not install that id from another catalog. Pick ids of your own.

## 1. Copy the repository

The repository of your catalog must be public, because the app downloads the
index without signing in. Copy only `main` and point it to an empty repository of
yours:

```
git clone --single-branch --branch main https://github.com/PantheonApp/pantheon-marketplace.git my-catalog
cd my-catalog
git remote set-url origin https://github.com/<owner>/<repo>.git
npm ci --ignore-scripts
git push -u origin main
```

This first push of `main` comes before you protect the branch (step 5): from then
on, every change comes in by pull request. It also starts the pipeline, and the
first publication fails until the secret of step 4 exists. That failure is
expected.

A fork works too, with two cautions. Turn GitHub Actions on in the Actions tab,
because it starts off in a fork. And do not bring the official `index` branch: if
it came along, delete it before you publish, because the pipeline compares the
versions with the index already on the `index` branch of your repository.

## 2. Make the key pair

In a folder outside the repository, so the private key never gets into a commit.
The `.gitignore` of the repository also ignores `*.key`, in case the key ends up
in the repository folder by mistake.

```sh
node -e '
const { generateKeyPairSync } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync("index-signing.key", privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
writeFileSync("index-signing.pub", publicKey.export({ type: "spki", format: "der" }).toString("base64") + "\n", { flag: "wx" });
'
```

It leaves two files. `index-signing.key` is the private key (Ed25519, PKCS8 PEM),
readable only by you. `index-signing.pub` is the public key (SPKI DER in base64,
one line), the one you give to the people who will use the catalog.

The command refuses to overwrite: if one of the two files is already in the
folder, it stops with an `EEXIST` error and leaves that file as it was. To make a
new pair, use another folder.

Before you go on, keep a copy of the private key in a password manager. Whoever
loses the private key can no longer publish updates the apps accept. And changing
the key later makes the items already installed stop updating.

## 3. Change what belongs to the official catalog

1. The public key. It is written in `keys/index-signing.pub`, in `PUBLIC_KEY` of
   `scripts/lib/signature.mjs`, in `test/signature.test.mjs` (which checks the
   two) and in both READMEs. From the repository folder, change them all at once:

   ```
   old="$(cat keys/index-signing.pub)"
   new="$(cat <keys folder>/index-signing.pub)"
   git grep -lF "$old" | xargs perl -pi -e "s|\Q$old\E|$new|g"
   git grep -F "$old"
   ```

   The last command must print nothing. If one is left behind, the pipeline stops
   before it publishes: right after signing, it checks the signature with
   `PUBLIC_KEY`.
2. The items. Delete the files in `connections/` and `templates/` and add yours,
   with ids of your own. [CONTRIBUTING.md](../CONTRIBUTING.md) explains every
   field. `retired.json` starts empty (`{}`).
3. `scripts/lib/official-connections.json` stays as it is. It lists the official
   types, and the validator refuses a type of yours with the name or the server of
   one of them. Do not publish an id from this list: your index would mark it
   official. The list stops on the day of the copy, but the app reserves every
   connection id the official catalog publishes. Before you pick an id, look at
   the items with `kind: "connection"` in the index the official catalog
   publishes:
   `https://raw.githubusercontent.com/PantheonApp/pantheon-marketplace/index/index.json`.
4. `.github/CODEOWNERS`: replace whoever is an owner with your GitHub accounts.
   `validate` checks that the list of official types has the same accounts as
   CODEOWNERS itself.
5. Both READMEs: the name of the catalog and the address of the index.
6. The tests. The ones in `test/` use the official items and accounts as examples,
   and the pipeline runs `npm test` before it publishes. Once you change the
   items, `npm test` points out the ones that depend on them (today in
   `test/index.test.mjs`, `test/validate.test.mjs`, `test/versions.test.mjs` and
   `test/codeowners.test.mjs`): adjust each one to your items and your accounts.
7. If you want a list of terms that must not reach the repository (a client's
   name, a person's), put one per line in
   `~/.config/app-marketplace/forbidden-terms`, or at the path in
   `MARKETPLACE_FORBIDDEN_TERMS`, outside the repository. Without the list,
   `validate` warns and skips that check.

Check:

```
npm run validate
npm test
```

## 4. Keep the private key in the pipeline

1. On GitHub, in Settings, Environments, create the `assinatura` environment,
   which is the name `.github/workflows/publish.yml` uses.
2. In Deployment branches and tags, choose Selected branches and tags and leave
   only `main`. That way only the publication from `main` reads the key.
3. Add the private key as the `INDEX_SIGNING_KEY` secret of that environment, the
   whole PEM file:

   ```
   gh secret set INDEX_SIGNING_KEY --env assinatura --repo <owner>/<repo> < <keys folder>/index-signing.key
   ```

4. With the copy in the password manager, delete `index-signing.key` from the
   disk. The private key never goes into the repository.

## 5. Protect the branches

The official catalog uses two rules (Settings, Rules, Rulesets):

- `main`: it cannot be deleted or force-pushed, every change comes in by pull
  request and the `validate` check must pass.
- `index`: it cannot be deleted or force-pushed. Only the pipeline writes to it,
  always a new commit on top of the last one. Do not require a pull request on
  `index`, or the pipeline cannot publish.

## 6. Publish

Every push to `main` (the merge of a pull request, with `main` protected)
publishes. The pipeline validates the items, runs the tests, checks that a changed
item went up in `version` and builds `index.json`. Then the job that reads the key
checks the index against its own checkout, signs it, checks the signature with
`PUBLIC_KEY` and writes `index.json`, `index.json.sig` and the item files to the
`index` branch.

To check it from outside, in an empty folder:

```
curl -fsSO https://raw.githubusercontent.com/<owner>/<repo>/index/index.json
curl -fsSO https://raw.githubusercontent.com/<owner>/<repo>/index/index.json.sig
node <repository folder>/scripts/verify-index.mjs index.json --public-key "$(cat <repository folder>/keys/index-signing.pub)"
```

The right answer ends in `is valid`.

## 7. Hand over the three things

The people who will use the catalog type into the app:

- the name of the catalog;
- the address of the index, the raw address of the `index` branch:
  `https://raw.githubusercontent.com/<owner>/<repo>/index`;
- the public key, the line in `keys/index-signing.pub`.

Send the key over a channel the person trusts. The app never downloads the key
from the address: the key is what proves the index came from you.

The app limits a catalog from someone else to: `https`, port 443, no redirects,
up to 200 items and up to 2 MiB, counting the index and the items together. The
`build-index` of this repository checks the 2 MiB on the index alone and takes up
to 500 items, the limit of the official catalog, so count yours.

The app only swaps the index it already has for one with a newer `committedAt`
(the time of the `main` commit the index was built from). And the name the
person types into the app cannot be the name of the official catalog.
