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

TODO

- **stripe integration** to charge for companies and buying tasks
