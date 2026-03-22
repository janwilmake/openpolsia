What makes it good:

- really high conversion to wow moment
- the identity of the email sending stays polsia, not your own domain/identity, making it easier for people to be comfortable doing this
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

- A user should get one or more durable objects with their own company instance(s): a DB with documents, tasks, chat, email, logs
- There should be a master D1 db for all users with balance, companies, transactions
- Google Login -> get name + email. The same wow-factor with good paywall onboarding
- frontend showing all data available for the company
- LLM with tools to do all things needed.
