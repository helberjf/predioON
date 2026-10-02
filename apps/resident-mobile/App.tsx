import React from "react";
import { PredioApp } from "@predioon/mobile";
import { API_URL } from "./config";
export default function App() {
  return <PredioApp product="resident" apiUrl={API_URL} />;
}
