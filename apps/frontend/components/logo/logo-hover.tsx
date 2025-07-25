"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import "./logo-animation.css";

const sizes = {
  sm: {
    width: 16,
    height: 16,
    className: "logo-sm",
    animatedWidth: 240,
  },
  md: {
    width: 20,
    height: 20,
    className: "logo-md",
    animatedWidth: 300,
  },
  lg: {
    width: 25,
    height: 25,
    className: "logo-lg",
    animatedWidth: 375,
  },
};

// SVG content for the animated logo frames (extracted from shadow-logo-hover.svg)
const animatedLogoFrames = (
  <svg width="301" height="21" viewBox="0 0 301 21" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="0.5" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="15.0455" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="2.31818" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.59091" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="5.95455" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="16.8636" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="4.13636" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="15.0455" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="2.31818" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="13.2273" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="13.2273" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="2.31818" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="15.0455" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="4.13636" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="16.8636" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="5.95455" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.59091" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.59091" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.59091" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.59091" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.59091" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.59091" y="0.5" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.59091" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="16.8636" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="4.13636" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="18.6818" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="5.95455" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="13.2273" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="20.5" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="35.0455" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="22.3182" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="29.5909" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="25.9545" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="36.8636" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="24.1364" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="35.0455" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="22.3182" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="33.2273" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="33.2273" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="22.3182" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="35.0455" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="24.1364" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="36.8636" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="25.9545" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="29.5909" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="29.5909" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="29.5909" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="29.5909" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="29.5909" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="29.5909" y="0.5" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="29.5909" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="36.8636" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="24.1364" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="38.6818" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="25.9545" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="33.2273" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="40.5" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="55.0455" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="42.3182" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="49.5909" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="45.9545" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="56.8636" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="44.1364" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="55.0455" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="42.3182" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="53.2273" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="53.2273" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="42.3182" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="55.0455" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="44.1364" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="56.8636" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="45.9545" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="49.5909" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="49.5909" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="49.5909" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="49.5909" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="49.5909" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="49.5909" y="0.5" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="49.5909" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="56.8636" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="44.1364" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="58.6818" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="45.9545" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="53.2273" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="60.5" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="75.0455" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="62.3182" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="69.5909" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="65.9545" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="76.8636" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="64.1364" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="75.0455" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="62.3182" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="73.2273" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="73.2273" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="62.3182" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="75.0455" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="64.1364" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="76.8636" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="65.9545" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="69.5909" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="69.5909" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="69.5909" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="69.5909" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="69.5909" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="69.5909" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="76.8636" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="64.1364" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="78.6818" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="65.9545" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="73.2273" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="80.5" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="95.0455" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="82.3182" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="89.5909" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="85.9545" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="96.8636" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="84.1364" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="95.0455" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="82.3182" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="93.2273" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="93.2273" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="82.3182" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="95.0455" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="84.1364" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="85.9545" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="89.5909" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="89.5909" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="89.5909" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="89.5909" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="96.8636" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="84.1364" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="98.6818" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="85.9545" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="93.2273" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="100.5" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="115.045" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="102.318" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="109.591" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="105.955" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="116.864" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="104.136" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="115.045" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="102.318" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="113.227" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="113.227" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="102.318" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="104.136" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="105.955" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="109.591" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="109.591" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="109.591" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="109.591" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="109.591" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="109.591" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="116.864" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="104.136" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="105.955" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="113.227" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="120.5" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="122.318" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="129.591" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="125.955" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="124.136" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="135.045" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="122.318" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="133.227" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="133.227" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="135.045" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="122.318" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="124.136" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="125.955" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="129.591" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="129.591" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="129.591" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="129.591" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="129.591" y="0.5" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="129.591" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="129.591" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="124.136" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="125.955" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="133.227" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="140.5" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="155.045" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="156.864" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="142.318" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="149.591" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="145.955" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="144.136" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="142.318" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="153.227" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="153.227" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="155.045" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="156.864" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="142.318" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="144.136" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="145.955" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="149.591" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="149.591" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="149.591" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="149.591" y="0.5" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="149.591" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="149.591" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="144.136" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="145.955" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="153.227" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="160.5" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="175.045" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="176.864" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="178.682" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="162.318" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="169.591" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="165.955" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="164.136" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="162.318" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="173.227" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="175.045" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="173.227" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="175.045" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="176.864" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="164.136" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="165.955" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="169.591" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="169.591" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="169.591" y="0.5" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="169.591" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="164.136" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="165.955" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="173.227" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="195.045" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="196.864" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="198.682" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="182.318" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="189.591" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="185.955" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="184.136" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="182.318" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="193.227" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="195.045" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="196.864" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="193.227" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="195.045" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="196.864" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="185.955" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="189.591" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="189.591" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="189.591" y="0.5" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="189.591" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="189.591" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="189.591" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="184.136" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="185.955" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="193.227" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="215.045" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="216.864" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="218.682" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="209.591" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="205.955" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="204.136" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="213.227" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="215.045" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="216.864" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="213.227" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="215.045" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="216.864" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="204.136" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="205.955" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="209.591" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="209.591" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="209.591" y="0.5" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="209.591" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="209.591" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="209.591" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="209.591" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="205.955" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="213.227" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="235.045" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="236.864" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="238.682" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="229.591" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="225.955" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="233.227" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="235.045" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="236.864" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="233.227" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="235.045" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="236.864" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="224.136" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="222.318" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="225.955" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="229.591" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="229.591" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="229.591" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="229.591" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="229.591" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="229.591" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="224.136" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="222.318" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="225.955" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="233.227" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="255.045" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="256.864" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="258.682" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="249.591" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="245.955" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="244.136" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="253.227" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="255.045" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="256.864" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="253.227" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="255.045" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="244.136" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="242.318" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="245.955" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="249.591" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="249.591" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="249.591" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="249.591" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="244.136" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="242.318" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="240.5" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="245.955" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="253.227" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="275.045" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="276.864" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="278.682" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="269.591" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="265.955" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="264.136" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="262.318" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="273.227" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="275.045" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="276.864" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="273.227" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="275.045" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="276.864" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="264.136" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="262.318" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="265.955" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="269.591" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="269.591" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="269.591" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="269.591" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="269.591" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="269.591" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="264.136" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="262.318" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="260.5" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="265.955" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="273.227" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="295.045" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="296.864" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="298.682" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="289.591" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="285.955" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="284.136" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="282.318" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="293.227" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="295.045" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="296.864" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="293.227" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="295.045" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="296.864" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="284.136" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="282.318" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="285.955" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="289.591" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="289.591" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="289.591" y="0.5" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="289.591" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="289.591" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="289.591" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="289.591" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="284.136" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="282.318" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="280.5" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="285.955" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="293.227" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
  </svg>
);

// Static logo version - matches shadow.svg
const staticLogo = (
  <svg width="20" height="21" viewBox="0 0 20 21" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="14.5455" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="1.81818" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.09091" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="5.45455" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="16.3636" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="3.63636" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="14.5455" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="1.81818" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="12.7273" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="12.7273" y="5.95454" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="1.81818" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="14.5455" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="3.63636" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="16.3636" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="5.45455" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.09091" y="16.8636" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.09091" y="18.6818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.09091" y="4.13637" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.09091" y="15.0455" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.09091" y="2.31818" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.09091" y="0.5" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="9.09091" y="13.2273" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="16.3636" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="3.63636" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="18.1818" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="5.45455" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
    <rect x="12.7273" y="9.59091" width="1.81818" height="1.81818" className="logo-fill"/>
  </svg>
);

export function LogoHover({
  forceAnimate,
  size = "md",
  className,
  colorClass = "fill-white", // Default to white, but allow custom Tailwind color classes
}: {
  forceAnimate?: boolean;
  size?: keyof typeof sizes;
  className?: string;
  colorClass?: string; // New prop for Tailwind color classes like "fill-red-500", "fill-blue-500", etc.
}) {
  const [isAnimating, setIsAnimating] = useState(false);

  const shouldAnimate = forceAnimate !== undefined ? forceAnimate : isAnimating;

  return (
    <div
      className={cn("overflow-hidden", className)}
      style={{ width: sizes[size].width, height: sizes[size].height }}
    >
      <div
        className={cn(
          "logo-container-svg",
          sizes[size].className,
          colorClass // Apply the color class here
        )}
        role="img"
        aria-label="Logo"
        data-animate={shouldAnimate.toString()}
        style={{
          width: shouldAnimate ? sizes[size].animatedWidth : sizes[size].width,
          height: sizes[size].height,
        }}
        onMouseEnter={() => {
          if (forceAnimate === undefined) {
            setIsAnimating(true);
          }
        }}
        onMouseLeave={() => {
          if (forceAnimate === undefined) {
            setIsAnimating(false);
          }
        }}
      >
        {shouldAnimate ? animatedLogoFrames : staticLogo}
      </div>
    </div>
  );
}
