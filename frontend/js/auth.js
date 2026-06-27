import { auth } from './firebase-config.js';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

// Expose updateProfile for use by app.js (non-module script)
window._updateFirebaseProfile = updateProfile;

const currentPath = window.location.pathname;
const isAppPage = currentPath.endsWith('app.html');

// Auth state listener
  onAuthStateChanged(auth, (user) => {
    if (user) {
      // User is signed in.
      window._firebaseUser = user; // expose for app.js profile editing
      if (!isAppPage) {
        window.location.href = 'app.html';
      } else {
        // Update user profile in app.html
        const displayName = user.displayName || user.email.split('@')[0];
        document.querySelectorAll('.profile-email, .user-email').forEach(el => el.textContent = user.email);
        document.querySelectorAll('.user-name, .profile-name').forEach(el => el.textContent = displayName);
        document.querySelectorAll('.user-avatar').forEach(el => el.textContent = displayName.charAt(0).toUpperCase());
        document.querySelectorAll('.welcome-greeting').forEach(el => el.textContent = `Good morning, ${displayName} 👋`);
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
    const signupError = document.createElement('div');
    signupError.style.cssText = "color: #c94040; font-size: 0.85rem; margin-bottom: 1rem; display: none;";
    if (signupForm) {
      const submitBtn = document.getElementById('signup-submit');
      signupForm.insertBefore(signupError, submitBtn);

      signupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const confirm = document.getElementById('signup-confirm').value;

        signupError.style.display = 'none';

        if (!email || !password || !confirm) {
          signupError.textContent = "Please fill in all required fields.";
          signupError.style.display = 'block';
          return;
        }

        if (password !== confirm) {
          signupError.textContent = "Passwords do not match.";
          signupError.style.display = 'block';
          return;
        }

        submitBtn.disabled = true;
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Creating account...';

        createUserWithEmailAndPassword(auth, email, password)
          .then((userCredential) => {
            // Show success modal instead of redirecting immediately
            document.getElementById('modal-form-view').style.display = 'none';
            const modalSuccess = document.getElementById('modal-success');
            if (modalSuccess) modalSuccess.classList.add('show');
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
          })
          .catch((error) => {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            signupError.textContent = error.message;
            signupError.style.display = 'block';
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
            
            let errorMsg = error.message;
            if (error.code === 'auth/invalid-credential') {
              errorMsg = "Incorrect email or password.";
            }
            
            if (loginError) {
              loginError.textContent = errorMsg;
              loginError.style.display = 'block';
            } else {
              alert(errorMsg);
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
