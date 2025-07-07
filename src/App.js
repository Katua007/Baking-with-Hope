import logo from './logo.svg';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Edit <code>src/App.js</code> and save to reload.
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
      </header>
    </div>
  );
}

export default App;

    
        import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
        import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
        import { getFirestore, doc, getDoc, setDoc, addDoc, onSnapshot, collection, query, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

        // Global Firebase variables
        let app;
        let db;
        let auth;
        let userId = null;
        let currentProductForOrder = null; // To store which product is being ordered
        let onSnapshotOrdersListener = null; // To store the unsubscribe function for the orders listener
        let isInitialAuthChecked = false; // Flag to ensure initial fetches happen only once after auth state is determined

        // Ensure __app_id and __firebase_config are defined in the environment
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

        // Initialize Firebase
        try {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
        } catch (error) {
            console.error("Firebase initialization error:", error);
            window.showMessageModal("Error", "Failed to initialize Firebase. Please check console for details.");
        }

        // --- UI Functions (made global for inline onclicks) ---

        /**
         * Shows a generic message modal.
         * @param {string} title - The title of the message.
         * @param {string} message - The content of the message.
         */
        window.showMessageModal = function(title, message) {
            const modal = document.getElementById('message-modal');
            document.getElementById('message-modal-title').textContent = title;
            document.getElementById('message-modal-text').textContent = message;
            modal.classList.add('active');
        }

        /**
         * Shows a specific modal by its ID.
         * @param {string} modalId - The ID of the modal to show.
         */
        window.showModal = function(modalId) {
            document.getElementById(modalId).classList.add('active');
        }

        /**
         * Closes a specific modal by its ID.
         * @param {string} modalId - The ID of the modal to close.
         */
        window.closeModal = function(modalId) {
            document.getElementById(modalId).classList.remove('active');
        }

        /**
         * Scrolls to a given element smoothly.
         * @param {string} targetId - The ID of the element to scroll to.
         */
        window.scrollToSection = function(targetId) {
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth' });
            }
        }

        // --- Auth State Listener ---
        onAuthStateChanged(auth, async (user) => {
            const userIdDisplay = document.getElementById('user-id-display');
            const userInfoDiv = document.getElementById('user-info');
            const loginButton = document.getElementById('login-button');
            const signupButton = document.getElementById('signup-button');
            const logoutButton = document.getElementById('logout-button');
            const submitReviewButton = document.getElementById('submit-review-button');
            const bakerControls = document.getElementById('baker-controls');
            const ordersNavLink = document.getElementById('orders-nav-link');

            if (user) {
                userId = user.uid;
                userIdDisplay.textContent = userId;
                userInfoDiv.style.display = 'block';
                loginButton.style.display = 'none';
                signupButton.style.display = 'none';
                logoutButton.style.display = 'inline-block';
                submitReviewButton.disabled = false; // Enable review submission for logged-in users

                // Simulate baker role for simplicity: if logged in, show baker controls
                bakerControls.style.display = 'block';
                ordersNavLink.style.display = 'inline-block'; // Show "Orders (Baker)" in nav

                // If user is logged in, ensure real-time orders listener is set up
                if (db && !onSnapshotOrdersListener) {
                    setupRealtimeOrdersListener();
                }

            } else {
                userId = null;
                userInfoDiv.style.display = 'none';
                loginButton.style.display = 'inline-block';
                signupButton.style.display = 'inline-block';
                logoutButton.style.display = 'none';
                submitReviewButton.disabled = true; // Disable review submission if not logged in
                bakerControls.style.display = 'none';
                ordersNavLink.style.display = 'none'; // Hide "Orders (Baker)" in nav

                // Detach orders listener if user logs out
                if (onSnapshotOrdersListener) {
                    onSnapshotOrdersListener(); // Unsubscribe
                    onSnapshotOrdersListener = null;
                    document.getElementById('orders-list').innerHTML = '<p>No orders yet!</p>'; // Clear orders display
                }

                // Handle initial sign-in if no user is authenticated yet and auth check hasn't completed
                if (!isInitialAuthChecked) {
                    if (typeof __initial_auth_token !== 'undefined') {
                        try {
                            await signInWithCustomToken(auth, __initial_auth_token);
                            console.log("Signed in with custom token via onAuthStateChanged.");
                        } catch (error) {
                            console.error("Custom token sign-in failed during onAuthStateChanged:", error);
                            // If custom token fails, proceed to anonymous sign-in as a fallback
                            try {
                                await signInAnonymously(auth);
                                console.log("Signed in anonymously after custom token failure.");
                            } catch (anonError) {
                                console.error("Anonymous sign-in fallback failed:", anonError);
                                window.showMessageModal("Error", "Could not sign in anonymously. Some features may be limited.");
                            }
                        }
                    } else { // No custom token, just try anonymous
                        try {
                            await signInAnonymously(auth);
                            console.log("Signed in anonymously.");
                        } catch (error) {
                            console.error("Anonymous sign-in failed:", error);
                            window.showMessageModal("Error", "Could not sign in anonymously. Some features may be limited.");
                        }
                    }
                }
            }

            // After auth state is determined (either logged in, anonymous, or failed to sign in), then fetch initial data
            if (db && !isInitialAuthChecked) { // Fetch data only once after initial auth check
                isInitialAuthChecked = true;
                await fetchProducts();
                await fetchReviews();
                await fetchSocialLinks();
            }
        });


        // --- Firebase Firestore Functions ---

        /**
         * Fetches and displays products from Firestore in real-time.
         */
        async function fetchProducts() {
            if (!db) { console.error("Firestore not initialized."); return; }
            const productsCollectionRef = collection(db, `artifacts/${appId}/public/data/products`);
            const productListDiv = document.getElementById('product-list');
            const reviewProductSelect = document.getElementById('review-product-select');

            onSnapshot(productsCollectionRef, (snapshot) => {
                productListDiv.innerHTML = ''; // Clear existing products
                reviewProductSelect.innerHTML = '<option value="">Select a product...</option>'; // Clear existing options
                if (snapshot.empty) {
                    productListDiv.innerHTML = '<p style="text-align: center; width: 100%;">No products available yet!</p>';
                } else {
                    const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    // Sort products by creation date in descending order (newest first)
                    products.sort((a, b) => (b.createdAt?.toDate() || 0) - (a.createdAt?.toDate() || 0));

                    products.forEach(product => {
                        const productCard = document.createElement('div');
                        productCard.className = 'product-card';
                        productCard.innerHTML = `
                            <img src="${product.imageUrl || 'https://placehold.co/400x300/cccccc/333333?text=No+Image'}" alt="${product.name}" onerror="this.onerror=null;this.src='https://placehold.co/400x300/cccccc/333333?text=Image+Error';">
                            <div class="product-card-content">
                                <h3>${product.name}</h3>
                                <p><strong>Ingredients:</strong> ${product.ingredients}</p>
                                <button class="order-button" data-product-id="${product.id}" data-product-name="${product.name}">Order Now</button>
                            </div>
                        `;
                        productListDiv.appendChild(productCard);

                        // Add product to review select dropdown
                        const option = document.createElement('option');
                        option.value = product.id;
                        option.textContent = product.name;
                        reviewProductSelect.appendChild(option);
                    });

                    // Add event listeners to new order buttons
                    document.querySelectorAll('.order-button').forEach(button => {
                        button.onclick = (event) => {
                            const productId = event.target.dataset.productId;
                            const productName = event.target.dataset.productName;
                            showOrderModal(productId, productName);
                        };
                    });
                }
            }, (error) => {
                console.error("Error fetching products:", error);
                window.showMessageModal("Error", "Failed to load products.");
            });
        }

        /**
         * Handles the submission of a new product by the baker.
         * @param {Event} event - The form submission event.
         */
        async function handleProductUpload(event) {
            event.preventDefault();
            if (!userId) {
                window.showMessageModal("Error", "You must be logged in to upload products.");
                return;
            }

            const productName = document.getElementById('new-product-name').value;
            const productIngredients = document.getElementById('new-product-ingredients').value;
            const productImageUrl = document.getElementById('new-product-image-url').value;

            try {
                // Store in public collection /artifacts/{appId}/public/data/products
                await addDoc(collection(db, `artifacts/${appId}/public/data/products`), {
                    name: productName,
                    ingredients: productIngredients,
                    imageUrl: productImageUrl,
                    createdAt: serverTimestamp(),
                    uploadedBy: userId // Track who uploaded it
                });
                window.showMessageModal("Success", "Product uploaded successfully!");
                document.getElementById('product-upload-form').reset();
                window.closeModal('product-upload-modal');
            } catch (error) {
                console.error("Error uploading product:", error);
                window.showMessageModal("Error", "Failed to upload product. " + error.message);
            }
        }

        /**
         * Shows the order modal and populates product details.
         * @param {string} productId - The ID of the product being ordered.
         * @param {string} productName - The name of the product being ordered.
         */
        function showOrderModal(productId, productName) {
            if (!userId) {
                window.showMessageModal("Login Required", "Please log in or sign up to place an order.");
                window.showModal('auth-modal'); // Open auth modal if not logged in
                return;
            }
            currentProductForOrder = { id: productId, name: productName };
            document.getElementById('order-product-name').textContent = productName;
            document.getElementById('finalize-order-button').style.display = 'none'; // Hide until payment is simulated
            window.showModal('order-modal');
        }

        /**
         * Handles order submission and payment simulation.
         * @param {Event} event - The form submission event.
         * @param {string} paymentMethod - The simulated payment method ('M-Pesa', 'PayPal', 'Card').
         */
        async function handleOrderSubmission(event, paymentMethod) {
            event.preventDefault();

            if (!userId) {
                window.showMessageModal("Error", "You must be logged in to place an order.");
                return;
            }
            if (!currentProductForOrder) {
                window.showMessageModal("Error", "No product selected for order.");
                return;
            }

            const customerName = document.getElementById('customer-name').value;
            const customerPhone = document.getElementById('customer-phone').value;
            const deliveryDate = document.getElementById('delivery-date').value;
            const deliveryTime = document.getElementById('delivery-time').value;
            const deliveryLocation = document.getElementById('delivery-location').value;
            const quantity = document.getElementById('product-quantity').value;

            // Simulate payment
            let paymentSuccess = false;
            let paymentMessage = "";

            if (paymentMethod === 'M-Pesa') {
                const pin = prompt("Simulating M-Pesa: Enter your M-Pesa PIN (any input will succeed):");
                if (pin) {
                    paymentSuccess = true;
                    paymentMessage = "M-Pesa payment successful!";
                } else {
                    paymentMessage = "M-Pesa payment cancelled.";
                }
            } else if (paymentMethod === 'PayPal') {
                // Simulate a PayPal redirect and return
                const confirmPaypal = confirm("Simulating PayPal: Click OK to proceed with payment.");
                if (confirmPaypal) {
                    paymentSuccess = true;
                    paymentMessage = "PayPal payment successful!";
                } else {
                    paymentMessage = "PayPal payment cancelled.";
                }
            } else if (paymentMethod === 'Card') {
                // Simulate a card payment form (simplified)
                const confirmCard = confirm("Simulating Card Payment: Click OK to proceed with payment.");
                if (confirmCard) {
                    paymentSuccess = true;
                    paymentMessage = "Card payment successful!";
                } else {
                    paymentMessage = "Card payment cancelled.";
                }
            }

            if (!paymentSuccess) {
                window.showMessageModal("Payment Failed", paymentMessage + " Order not placed.");
                return;
            }

            try {
                await addDoc(collection(db, `artifacts/${appId}/public/data/orders`), {
                    productId: currentProductForOrder.id,
                    productName: currentProductForOrder.name,
                    customerName: customerName,
                    customerPhone: customerPhone,
                    deliveryDate: deliveryDate,
                    deliveryTime: deliveryTime,
                    deliveryLocation: deliveryLocation,
                    quantity: parseInt(quantity),
                    paymentMethod: paymentMethod,
                    paymentStatus: 'Paid',
                    orderStatus: 'Pending',
                    orderedAt: serverTimestamp(),
                    orderedBy: userId
                });

                window.showMessageModal("Order Placed!", `Your order for ${currentProductForOrder.name} has been placed successfully! ${paymentMessage} The baker will contact you shortly regarding delivery. Please spread the word about Baking-with-Hope for better deals next time!`);
                document.getElementById('order-form').reset();
                window.closeModal('order-modal');
                currentProductForOrder = null;
            } catch (error) {
                console.error("Error placing order:", error);
                window.showMessageModal("Error", "Failed to place order. " + error.message);
            }
        }

        /**
         * Sets up a real-time listener for customer orders for the baker.
         */
        function setupRealtimeOrdersListener() {
            if (!db || !userId) { return; } // Ensure DB and user are ready
            const ordersCollectionRef = collection(db, `artifacts/${appId}/public/data/orders`);
            const ordersListDiv = document.getElementById('orders-list');

            // Unsubscribe from previous listener if exists
            if (onSnapshotOrdersListener) {
                onSnapshotOrdersListener();
            }

            // Listen for real-time updates without orderBy
            onSnapshotOrdersListener = onSnapshot(ordersCollectionRef, (snapshot) => {
                ordersListDiv.innerHTML = ''; // Clear existing orders
                if (snapshot.empty) {
                    ordersListDiv.innerHTML = '<p>No orders yet!</p>';
                } else {
                    const sortedOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                                                   .sort((a, b) => (b.orderedAt?.toDate() || 0) - (a.orderedAt?.toDate() || 0)); // Sort by most recent in JS

                    sortedOrders.forEach(order => {
                        const orderItem = document.createElement('div');
                        orderItem.className = 'order-item';
                        orderItem.innerHTML = `
                            <p><strong>Order ID:</strong> ${order.id}</p>
                            <p><strong>Product:</strong> ${order.productName} (x${order.quantity})</p>
                            <p><strong>Customer:</strong> ${order.customerName}</p>
                            <p><strong>Phone:</strong> ${order.customerPhone}</p>
                            <p><strong>Delivery:</strong> ${order.deliveryDate} at ${order.deliveryTime}</p>
                            <p><strong>Location:</strong> ${order.deliveryLocation}</p>
                            <p><strong>Payment:</strong> ${order.paymentMethod} - ${order.paymentStatus}</p>
                            <p><strong>Status:</strong> ${order.orderStatus}</p>
                            <p><em>Ordered at: ${order.orderedAt ? new Date(order.orderedAt.toDate()).toLocaleString() : 'N/A'}</em></p>
                        `;
                        ordersListDiv.appendChild(orderItem);
                    });
                }
            }, (error) => {
                console.error("Error fetching real-time orders:", error);
                // Optionally show error but don't clear existing orders for a transient error
            });
        }


        /**
         * Handles review submission.
         * @param {Event} event - The form submission event.
         */
        async function handleReviewSubmission(event) {
            event.preventDefault();
            if (!userId) {
                window.showMessageModal("Error", "You must be logged in to leave a review.");
                return;
            }

            const reviewProductId = document.getElementById('review-product-select').value;
            const reviewText = document.getElementById('review-text').value;

            if (!reviewProductId) {
                window.showMessageModal("Missing Info", "Please select the product you ordered.");
                return;
            }
            if (!reviewText.trim()) {
                window.showMessageModal("Missing Info", "Please write your review.");
                return;
            }

            try {
                // Get product name for review display
                const productDoc = await getDoc(doc(db, `artifacts/${appId}/public/data/products`, reviewProductId));
                const productName = productDoc.exists() ? productDoc.data().name : "Unknown Product";

                // Store review in public collection
                await addDoc(collection(db, `artifacts/${appId}/public/data/reviews`), {
                    productId: reviewProductId,
                    productName: productName,
                    reviewText: reviewText,
                    reviewerId: userId,
                    reviewedAt: serverTimestamp()
                });
                window.showMessageModal("Success", "Your review has been submitted!");
                document.getElementById('review-form').reset();
            } catch (error) {
                console.error("Error submitting review:", error);
                window.showMessageModal("Error", "Failed to submit review. " + error.message);
            }
        }

        /**
         * Fetches and displays reviews from Firestore.
         */
        async function fetchReviews() {
            if (!db) { console.error("Firestore not initialized."); return; }
            const reviewsCollectionRef = collection(db, `artifacts/${appId}/public/data/reviews`);
            const reviewListDiv = document.getElementById('review-list');

            onSnapshot(reviewsCollectionRef, (snapshot) => {
                reviewListDiv.innerHTML = ''; // Clear existing reviews
                if (snapshot.empty) {
                    reviewListDiv.innerHTML = '<p style="text-align: center;">No reviews yet. Be the first to leave one!</p>';
                } else {
                    const sortedReviews = snapshot.docs.map(doc => doc.data())
                                                     .sort((a, b) => (b.reviewedAt?.toDate() || 0) - (a.reviewedAt?.toDate() || 0)); // Sort by most recent in JS

                    sortedReviews.forEach(review => {
                        const reviewItem = document.createElement('div');
                        reviewItem.className = 'review-item';
                        // Display partial user ID for reviews (full ID for baker dashboard only)
                        const displayUserId = review.reviewerId ? review.reviewerId.substring(0, 8) + '...' : 'Anonymous';
                        reviewItem.innerHTML = `
                            <p class="reviewer-name">By User: ${displayUserId}</p>
                            <p class="review-text">"${review.reviewText}"</p>
                            <p class="review-product">Product: ${review.productName}</p>
                        `;
                        reviewListDiv.appendChild(reviewItem);
                    });
                }
            }, (error) => {
                console.error("Error fetching reviews:", error);
                window.showMessageModal("Error", "Failed to load reviews.");
            });
        }

        /**
         * Fetches and displays social media links.
         */
        async function fetchSocialLinks() {
            if (!db) { console.error("Firestore not initialized."); return; }
            const socialLinksDocRef = doc(db, `artifacts/${appId}/public/data/settings/social`);
            const instagramIcon = document.getElementById('instagram-icon');
            const facebookIcon = document.getElementById('facebook-icon');
            const instagramLinkInput = document.getElementById('instagram-link');
            const facebookLinkInput = document.getElementById('facebook-link');


            try {
                const docSnap = await getDoc(socialLinksDocRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.instagram) {
                        instagramIcon.href = data.instagram;
                        instagramIcon.style.display = 'inline-block';
                        instagramLinkInput.value = data.instagram;
                    } else {
                        instagramIcon.style.display = 'none';
                    }
                    if (data.facebook) {
                        facebookIcon.href = data.facebook;
                        facebookIcon.style.display = 'inline-block';
                        facebookLinkInput.value = data.facebook;
                    } else {
                        facebookIcon.style.display = 'none';
                    }
                }
            } catch (error) {
                console.error("Error fetching social links:", error);
            }
        }

        /**
         * Saves social media links for the baker.
         */
        async function saveSocialLinks() {
            if (!userId) {
                window.showMessageModal("Error", "You must be logged in to manage social links.");
                return;
            }
            if (!db) { console.error("Firestore not initialized."); return; }

            const instagramLink = document.getElementById('instagram-link').value.trim();
            const facebookLink = document.getElementById('facebook-link').value.trim();

            const socialLinksData = {};
            if (instagramLink) socialLinksData.instagram = instagramLink;
            if (facebookLink) socialLinksData.facebook = facebookLink;

            try {
                // Store in public collection /artifacts/{appId}/public/data/settings/social
                await setDoc(doc(db, `artifacts/${appId}/public/data/settings/social`), socialLinksData, { merge: true });
                window.showMessageModal("Success", "Social links saved successfully!");
                await fetchSocialLinks(); // Refresh display
            } catch (error) {
                console.error("Error saving social links:", error);
                window.showMessageModal("Error", "Failed to save social links. " + error.message);
            }
        }

        // --- Event Listeners ---

        // Smooth scroll for navigation
        document.querySelectorAll('nav a').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const targetId = this.getAttribute('href').substring(1);
                if (targetId) { // Only scroll if it's a valid section ID
                    window.scrollToSection(targetId);
                    // Hide baker orders section if navigating away from it
                    if (targetId !== 'orders-baker-section') {
                        document.getElementById('orders-baker-section').style.display = 'none';
                    }
                }
            });
        });

        // Login/Signup Modal controls
        document.getElementById('login-button').addEventListener('click', () => {
            document.getElementById('auth-modal-title').textContent = 'Login';
            document.getElementById('auth-submit-button').textContent = 'Login';
            document.getElementById('auth-form').onsubmit = handleLogin;
            window.showModal('auth-modal');
        });

        document.getElementById('signup-button').addEventListener('click', () => {
            document.getElementById('auth-modal-title').textContent = 'Sign Up';
            document.getElementById('auth-submit-button').textContent = 'Sign Up';
            document.getElementById('auth-form').onsubmit = handleSignUp;
            window.showModal('auth-modal');
        });

        document.getElementById('logout-button').addEventListener('click', async () => {
            try {
                await signOut(auth);
                window.showMessageModal("Logged Out", "You have been successfully logged out.");
                // Hide order section if visible for baker
                document.getElementById('orders-baker-section').style.display = 'none';
            } catch (error) {
                console.error("Error logging out:", error);
                window.showMessageModal("Error", "Failed to log out: " + error.message);
            }
        });

        // Handle Login/Signup form submission
        async function handleLogin(event) {
            event.preventDefault();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;

            try {
                await signInWithEmailAndPassword(auth, email, password);
                window.showMessageModal("Success", "Logged in successfully!");
                window.closeModal('auth-modal');
            } catch (error) {
                console.error("Login failed:", error);
                window.showMessageModal("Login Error", error.message);
            }
        }

        async function handleSignUp(event) {
            event.preventDefault();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;

            try {
                await createUserWithEmailAndPassword(auth, email, password);
                window.showMessageModal("Success", "Account created and logged in!");
                window.closeModal('auth-modal');
            } catch (error) {
                console.error("Sign up failed:", error);
                window.showMessageModal("Sign Up Error", error.message);
            }
        }

        // Product Upload button for baker
        document.getElementById('add-product-button').addEventListener('click', () => {
            if (userId) {
                window.showModal('product-upload-modal');
            } else {
                window.showMessageModal("Access Denied", "Please login to manage products.");
            }
        });
        document.getElementById('product-upload-form').addEventListener('submit', handleProductUpload);


        // View Customer Orders button for baker
        document.getElementById('view-orders-button').addEventListener('click', () => {
            if (userId) {
                // Toggle visibility
                const ordersSection = document.getElementById('orders-baker-section');
                if (ordersSection.style.display === 'block') {
                    ordersSection.style.display = 'none';
                } else {
                    ordersSection.style.display = 'block';
                    window.scrollToSection('orders-baker-section'); // Scroll to orders section
                }
            } else {
                window.showMessageModal("Access Denied", "Please login to view orders.");
            }
        });

        // Manage Social Links button for baker
        document.getElementById('manage-social-button').addEventListener('click', () => {
            if (userId) {
                const socialManagementDiv = document.getElementById('social-link-management');
                socialManagementDiv.style.display = socialManagementDiv.style.display === 'none' ? 'block' : 'none';
                if (socialManagementDiv.style.display === 'block') {
                    fetchSocialLinks(); // Populate current links when opened
                }
            } else {
                window.showMessageModal("Access Denied", "Please login to manage social links.");
            }
        });
        document.getElementById('save-social-links').addEventListener('click', saveSocialLinks);


        // Payment buttons (inside order modal)
        document.getElementById('pay-mpesa-button').addEventListener('click', (event) => handleOrderSubmission(event, 'M-Pesa'));
        document.getElementById('pay-paypal-button').addEventListener('click', (event) => handleOrderSubmission(event, 'PayPal'));
        document.getElementById('pay-card-button').addEventListener('click', (event) => handleOrderSubmission(event, 'Card'));

        // Review form submission
        document.getElementById('review-form').addEventListener('submit', handleReviewSubmission);

        // Initial setup for review form product selection, assumes products are loaded
        // This is handled by fetchProducts via onSnapshot, so the dropdown will populate dynamically.
    