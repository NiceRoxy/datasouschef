import { auth } from './firebase-config.js';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail,
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

const currentPath = window.location.pathname;
const isAppPage = currentPath.endsWith('app.html');

// Auth state listener
  onAuthStateChanged(auth, (user) => {
    if (user) {
      // User is signed in.
      if (!isAppPage) {
        window.location.href = 'app.html';
      } else {
        // Update user profile in app.html
        const emailElements = document.querySelectorAll('.profile-email, .user-email');
        emailElements.forEach(el => el.textContent = user.email);
      }
    } else {
      // No user is signed in.
      if (isAppPage) {
        window.location.href = 'index.html';
      }
    }
  });

  if (!isAppPage) {
    // We are on index.html, handle modal logic
    const signupView = document.getElementById('signup-view');
    const loginView = document.getElementById('login-view');
    const showLoginBtn = document.getElementById('modal-show-login');
    const showSignupBtn = document.getElementById('modal-show-signup');

    if (showLoginBtn && showSignupBtn) {
      showLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        signupView.style.display = 'none';
        loginView.style.display = 'block';
      });

      showSignupBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loginView.style.display = 'none';
        signupView.style.display = 'block';
      });
    }

    // Signup form
    const signupForm = document.getElementById('signup-form');
    if (signupForm) {
      signupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const confirm = document.getElementById('signup-confirm').value;

        if (password !== confirm) {
          alert("Passwords do not match");
          return;
        }

        createUserWithEmailAndPassword(auth, email, password)
          .then((userCredential) => {
            // Signed up successfully
            window.location.href = 'app.html';
          })
          .catch((error) => {
            alert(error.message);
          });
      });
    }

    // Login form
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const submitBtn = document.getElementById('login-submit');

        submitBtn.disabled = true;
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Logging in...';

        signInWithEmailAndPassword(auth, email, password)
          .then((userCredential) => {
            // Signed in successfully
            window.location.href = 'app.html';
          })
          .catch((error) => {
            console.error("Login failed:", error);
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            if (loginError) {
              loginError.textContent = error.message;
              loginError.style.display = 'block';
            } else {
              alert(error.message);
            }
          });
      });
    }

    // Forgot password
    const forgotBtn = document.getElementById('forgot-password-link');
    if (forgotBtn) {
      forgotBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        if (!email) {
          alert('Please enter your email address in the field above first.');
          return;
        }
        sendPasswordResetEmail(auth, email)
          .then(() => {
            alert('Password reset email sent! Check your inbox.');
          })
          .catch((error) => {
            alert(error.message);
          });
      });
    }

  } else {
    // We are on app.html, handle logout logic
    const logoutBtns = document.querySelectorAll('.sidebar-logout');
    logoutBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        signOut(auth).catch((error) => {
          console.error("Sign out error", error);
        });
      });
    });
  }
