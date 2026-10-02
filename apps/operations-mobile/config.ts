import { Platform } from "react-native";

// Set the production HTTPS origin before signing a release. No service secrets belong here.
const PRODUCTION_API_URL = "";
export const API_URL = __DEV__
  ? Platform.OS === "android"
    ? "http://10.0.2.2:3000"
    : "http://localhost:3000"
  : PRODUCTION_API_URL;
