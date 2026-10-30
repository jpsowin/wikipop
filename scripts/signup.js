// Email signup box shared by every page except the homepage (which has its
// own copy of these styles in template.html). Pages include SIGNUP_CSS in
// their <style>, signupHtml() where the box goes, and SIGNUP_SCRIPT once
// before </body> so GA records which placement converted.

const SIGNUP_HEADING = `Get <span class="signup-red">WikiPop'd</span> every morning`;
const SIGNUP_PITCH = "See what's trending on Wikipedia and why it spiked, plus one obscure gem.";

const SIGNUP_CSS = `
    .slanted-newsletter {
      background: var(--yellow, #ffdf00);
      border: 5px solid var(--black, #111);
      padding: 1.5rem;
      box-shadow: -10px 10px 0 var(--black, #111);
      transform: rotate(1.5deg);
      margin: 2.25rem 0.5rem 2rem 1rem;
    }
    .slanted-heading {
      font-family: "Bangers", cursive; font-weight: normal;
      font-size: clamp(1.4rem, 4vw, 1.8rem);
      line-height: 1.1; color: var(--black, #111); margin: 0 0 0.35rem;
    }
    .signup-red { color: #d00d00; }
    .slanted-sub { font-size: 0.95rem; line-height: 1.45; color: var(--black, #111); margin: 0 0 1rem; }
    .slanted-form { display: flex; gap: 0.5rem; }
    .slanted-input {
      flex: 1; border: 3px solid var(--black, #111); padding: 0.75rem 1rem;
      font-size: 1.1rem; font-family: inherit; min-width: 0; outline: none;
      background: var(--white, #fdfcf3);
    }
    .slanted-input:focus { border-color: #d00d00; }
    .slanted-btn {
      background: var(--white, #fdfcf3); color: var(--black, #111);
      border: 3px solid var(--black, #111); padding: 0.75rem 1.5rem;
      font-size: 1.1rem; font-family: "Bangers", cursive; cursor: pointer;
    }
    .slanted-btn:hover { background: var(--black, #111); color: var(--white, #fdfcf3); }
    .slanted-newsletter.compact { transform: rotate(-1deg); box-shadow: 8px 8px 0 var(--black, #111); margin: 1.75rem 0 1.5rem; padding: 1.1rem 1.25rem; }
    .slanted-newsletter.compact .slanted-heading { font-size: clamp(1.2rem, 3.5vw, 1.5rem); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (max-width: 600px) {
      .slanted-newsletter { margin: 1.75rem 0.25rem 1.5rem 0.5rem; padding: 1.1rem; }
      .slanted-form { flex-direction: column; }
    }`;

// placement: a short label ("day", "day-bottom", "archive", ...) sent to GA.
function signupHtml(placement, { compact = false } = {}) {
  const id = `bd-email-${placement}`;
  return `
    <aside class="slanted-newsletter${compact ? " compact" : ""}" aria-labelledby="${id}-h">
      <h2 class="slanted-heading" id="${id}-h">${SIGNUP_HEADING}</h2>
      <p class="slanted-sub">${SIGNUP_PITCH}</p>
      <form class="slanted-form" action="https://buttondown.com/api/emails/embed-subscribe/wikipop" method="post" data-placement="${placement}">
        <label for="${id}" class="visually-hidden">Email address</label>
        <input type="email" name="email" id="${id}" placeholder="you@email.com" required class="slanted-input" autocomplete="email">
        <button type="submit" class="slanted-btn">Subscribe</button>
      </form>
    </aside>`;
}

const SIGNUP_SCRIPT = `
  <script>
    document.querySelectorAll('.slanted-form').forEach(function (form) {
      form.addEventListener('submit', function () {
        if (window.gtag) gtag('event', 'sign_up', { method: 'email_subscribe', placement: form.dataset.placement });
      });
    });
  </script>`;

module.exports = { SIGNUP_CSS, SIGNUP_SCRIPT, SIGNUP_HEADING, SIGNUP_PITCH, signupHtml };
