[![Chat with Repo](https://badge.forgithub.com/janwilmake/openpolsia?badge=chat)](https://uithub.com/janwilmake/openpolsia)

What makes Polsia so good:

- really high conversion to wow moment
- the identity of the email sending stays Open Polsia, not your own domain/identity, making it easier for people to be comfortable doing this
- very good branding / logo. it feels like a game

First step - wow moment:

- research the person that logged in
- build and deploy a landing-page for them
- make a tweet about it
- setup an email and send a few
- make a few docuents
- make a few tasks

What are the components needed:

- stripe connect so the ai can make products and pay out the user
- (recurring) tasks that go onto a queue to be executed in parallel
- twitter account to post tweets from
- receive+send email from all addresses of the domain
- documents
- ads
- chat

What is an POC-level that is "good enough"?

- ✅ A user should get one or more durable objects with their own company instance(s): a DB with documents, tasks, chat, email, logs
- ✅ There should be a master D1 db for all users with balance, companies, transactions
- ✅ Google Login -> get name + email. The same wow-factor with good paywall onboarding
- ✅ frontend showing all data available for the company
- ✅ **email integration** to receive emails from `{slug}@openpolsia.com` in the right inbox and also send from any email @openpolsia.com
- ✅ **LLM operator** with systemprompt being a file hierarchy and a user message or task, if given, with tools: writeFile, readFile, justBash (see just-bash library: https://raw.githubusercontent.com/vercel-labs/just-bash/refs/heads/main/README.md), listTasks, createTask, editTask, sendMail, readMail, listMail, sendMessage, webSearch, webFetch (use parallel: https://docs.parallel.ai/api-reference/search-beta/search.md, https://docs.parallel.ai/api-reference/extract-beta/extract.md)
- **subdomain integration**
  - ✅ `*.openpolsia.com` should route to the worker
  - ✅ if a subdomain is the incoming domain, look up the subdomain to get the durable object, then serve `website/*` documents with path if available, otherwise serve 404. for `/` we should serve `website/index.html`. if `website/index.html` is not available, redirect to `openpolsia.com`
- ✅ **task executor queue**
- ✅ improve ui, making it more similar to polsia
- ✅ slug should adapt to the name which should be chosen in the first task
- ✅ make the dashboard auto-update using a SSE endpoint

- ✅ **stripe integration**
  - charge for companies ($50/m/company) and buying tasks ($1/task after 50 free)
  - only the initial creation is done for free, but then, tools are disabled until you purchase at least 1 company. the system prompt instructs the model to say that the user neds to purchase the subscription first.
  - there is a card on the left column 'business' that shows 'Hire Your AI Employee, $1.63/day · Works while you sleep, Start free trial, 3-day trial · $49/mo' that opens the payment modal when clicke
  - the payment modal allows selecing amount of companies to purchase
  - after purchasing there is a way to edit the subscription and also purchase more tasks at $1/task. The tasks are a one-time purchase, while the companies are a subscription.

```
For local testing: stripe listen --forward-to localhost:8787/api/webhooks/stripe
```

TODO

- **explore sandbox** have a coding agent make a real product on github + cloudflare + stripe + any other cli. determine how to login the user in a sandbox.
- cheaper kimi model?
- allow tasks to use MCPs?
- improve prompting of initial tasks so it's more like what we want
- queue 3 tasks without doing them on the free tier
- fix just-bash to be able to write to documents
- more visibility on the task queue logic
- **ads** - explore apis for ads
- **browser** explore a browser tool
