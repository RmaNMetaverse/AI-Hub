/** @type {import('tailwindcss').Config} */
export default {
  content: ["./views/**/*.ejs", "./public/js/**/*.js"],
  theme: {
    extend: {
      colors: {
        ink: "#08090a",
        panel: "#111214",
        line: "#26282c",
        acid: "#d6ff45"
      },
      boxShadow: {
        float: "0 24px 80px rgba(0, 0, 0, 0.48)"
      }
    }
  },
  plugins: []
};
