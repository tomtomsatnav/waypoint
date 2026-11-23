# Sign-up form

The sign-up page for a small community site. It should be friendly and clear: people should know what is wrong with
what they typed, and when, without being nagged before they have finished typing.

Fields: email, password, confirm password, age, and an "I agree to the terms" checkbox.
- Email must look like an email address.
- Password: at least 8 characters, with at least one letter and one digit.
- Confirm password must match.
- Age: a whole number from 13 to 120.
- The terms box must be ticked.

A field's error message appears once the person has left the field (or tried to submit), and disappears as soon as it is
fixed. The submit button is disabled until everything is valid. Submitting replaces the form with a thank-you message that
includes their email address. Accessible: labels on every field, errors announced to screen readers, keyboard friendly.

## Interface (for automated testing; keep these exactly)

Plain static files: `index.html` at the repository root (or in `dist/` after `npm run build`), served by any static web
server, no backend. Element ids: `email`, `password`, `confirm`, `age`, `terms` (the checkbox), `submit`; error messages
in `email-error`, `password-error`, `confirm-error`, `age-error`, `terms-error` (empty or hidden when there is no error);
the thank-you message in `success`. An invalid field has `aria-invalid="true"`.

## Done means

Someone can sign up without confusion, and cannot submit anything invalid.
