"use client";

import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";

export default function SwaggerViewer() {
  return <SwaggerUI url="/api/openapi" />;
}
