import { getUser } from "@/lib/auth/get-user";
import { NextRequest, NextResponse } from "next/server";
import { getApiKeys } from "@/lib/actions/api-keys";
import { ApiKeyValidator, ValidationResult } from "@/lib/api-key-validator";
import { ApiKeyProvider } from "@repo/types";

export interface ValidationResults {
  individualVerification: boolean;
  [provider: string]: ValidationResult | boolean;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body for optional provider parameter
    let provider: ApiKeyProvider | undefined;
    try {
      const body = await request.json();
      provider = body?.provider;
    } catch {
      // Empty body is fine, means validate all keys
    }

    const apiKeys = await getApiKeys();
    const validator = new ApiKeyValidator();

    // Determine if this is individual or bulk validation
    const isIndividualValidation = !!provider;

    let validationResults: Record<string, ValidationResult>;

    if (isIndividualValidation && provider) {
      // Individual validation - validate only the specified provider
      const apiKey = apiKeys[provider];
      if (!apiKey || !apiKey.trim()) {
        return NextResponse.json({
          individualVerification: true,
          [provider]: {
            isValid: false,
            error: `No ${provider} API key found`,
            latencyMs: 0,
          },
        });
      }

      const result = await validator.validateApiKey(provider, apiKey);
      validationResults = { [provider]: result };
    } else {
      // Bulk validation - validate all available keys
      const keysToValidate: Partial<Record<ApiKeyProvider, string>> = {};
      if (apiKeys.openai && apiKeys.openai.trim()) {
        keysToValidate.openai = apiKeys.openai;
      }
      if (apiKeys.anthropic && apiKeys.anthropic.trim()) {
        keysToValidate.anthropic = apiKeys.anthropic;
      }
      if (apiKeys.openrouter && apiKeys.openrouter.trim()) {
        keysToValidate.openrouter = apiKeys.openrouter;
      }

      validationResults = await validator.validateMultiple(keysToValidate);
    }

    const response: ValidationResults = {
      ...validationResults,
      individualVerification: isIndividualValidation,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error validating API keys:", error);
    return NextResponse.json(
      { error: "Failed to validate API keys" },
      { status: 500 }
    );
  }
}
