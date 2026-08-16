(function () {
  'use strict';

  const password = document.querySelector('#password');
  const passwordToggle = document.querySelector('#passwordToggle');
  const badgeLogin = document.querySelector('#badgeLogin');

  passwordToggle.addEventListener('click', function () {
    const shouldShow = password.type === 'password';
    password.type = shouldShow ? 'text' : 'password';
    passwordToggle.textContent = shouldShow ? 'Hide' : 'Show';
    passwordToggle.setAttribute('aria-label', shouldShow ? 'Hide password' : 'Show password');
  });

  badgeLogin.addEventListener('click', function () {
    window.location.href = 'index.html';
  });
})();
