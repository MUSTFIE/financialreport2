const firebaseConfig = {
  apiKey: "AIzaSyDARQel_FE1owKu7vcwj5Vb2mQQPHbdJUg",
  authDomain: "budget-tracker-f6987.firebaseapp.com",
  databaseURL: "https://budget-tracker-f6987-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "budget-tracker-f6987",
  storageBucket: "budget-tracker-f6987.firebasestorage.app",
  messagingSenderId: "95285914076",
  appId: "1:95285914076:web:44f6058eedbabc858cc719"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
