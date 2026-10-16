# Contributing

Bug reports, ideas and feedback are welcome as issues. Report security problems privately through the
[security policy](SECURITY.md).

Foxden is in early development and its direction is still taking shape, so please open an issue and agree a change
before starting a pull request. That keeps anyone from spending time on work that doesn't fit where it's going.

## Contribution terms

A contribution is any code, documentation or other material you submit for inclusion in Foxden, through a pull
request, an issue or any other channel.

By submitting a contribution, you grant Louis Collins, and any successor or assignee, a perpetual, worldwide,
non-exclusive, royalty-free, irrevocable licence:

- to use, reproduce, modify, distribute and sublicense it under any terms, including proprietary ones
- under any patent claims you own or control that the contribution alone or combined with Foxden would infringe, to
  make, have made, use, offer to sell, sell, import and otherwise transfer it, alone or combined with Foxden. This
  patent licence extends to anyone Louis Collins, or a successor or assignee, licenses Foxden to

In return, Louis Collins will consider the contribution for inclusion.

You confirm that:

- the contribution is your own work, or you have identified any third-party material in it and its licence
- apart from any third-party material you have identified, you have the right to make this grant, and anyone else with
  rights in the contribution, such as an employer, has agreed to it

Foxden, including your contribution, is published under [AGPL-3.0-only](LICENSE). Submitting a contribution means you
accept these terms.

## Local setup

Use the Node version in `.nvmrc` (currently 22.23):

```sh
npm install
npm run instance:start
```

The start command prints the URL. Sign in with `admin@foxden.test` and `TestPass123!`. Stop it with
`npm run instance:stop`.

## Pull requests

- Follow the style of the code around your change.
- Test at the lowest useful level, preferably with unit tests.
- Run `npm run code:check` to check formatting, linting, types and unit tests.
- Update the README or [deployment guide](DEPLOYMENT.md) when users need to know about the change.

When relevant, also run `npm run test:integration`, `npm run test:e2e`, `npm run test:firefox` or
`npm run test:android`. Read [the real Firefox test guide](firefox-e2e/README.md) first.
