import { prisma } from "@repo/db";

export interface UserSettings {
  id: string;
  userId: string;
  autoPullRequest: boolean;
  enableShadowWiki: boolean;
  memoriesEnabled: boolean;
  selectedModels: string[];
  miniModel?: string | null;
  enableIndexing: boolean;
  rules?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getUserSettings(
  userId: string
): Promise<UserSettings | null> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
  });

  return settings;
}

export async function createUserSettings(
  userId: string,
  settings: {
    autoPullRequest: boolean;
    enableShadowWiki?: boolean;
    memoriesEnabled?: boolean;
    selectedModels?: string[];
    miniModel?: string;
    enableIndexing?: boolean;
    rules?: string;
  }
): Promise<UserSettings> {
  const result = await prisma.userSettings.create({
    data: {
      userId,
      autoPullRequest: settings.autoPullRequest,
      enableShadowWiki: settings.enableShadowWiki ?? true,
      memoriesEnabled: settings.memoriesEnabled ?? true,
      selectedModels: settings.selectedModels ?? [],
      miniModel: settings.miniModel,
      enableIndexing: settings.enableIndexing ?? false,
      rules: settings.rules,
    },
  });

  return result;
}

export async function updateUserSettings(
  userId: string,
  settings: {
    autoPullRequest?: boolean;
    enableShadowWiki?: boolean;
    memoriesEnabled?: boolean;
    selectedModels?: string[];
    miniModel?: string | null;
    enableIndexing?: boolean;
    rules?: string;
  }
): Promise<UserSettings> {
  try {
    const updateData: {
      autoPullRequest?: boolean;
      enableShadowWiki?: boolean;
      memoriesEnabled?: boolean;
      selectedModels?: string[];
      miniModel?: string | null;
      enableIndexing?: boolean;
      rules?: string;
    } = {};

    if (settings.autoPullRequest !== undefined)
      updateData.autoPullRequest = settings.autoPullRequest;
    if (settings.enableShadowWiki !== undefined)
      updateData.enableShadowWiki = settings.enableShadowWiki;
    if (settings.memoriesEnabled !== undefined)
      updateData.memoriesEnabled = settings.memoriesEnabled;
    if (settings.selectedModels !== undefined)
      updateData.selectedModels = settings.selectedModels;
    if (settings.miniModel !== undefined)
      updateData.miniModel = settings.miniModel;
    if (settings.enableIndexing !== undefined)
      updateData.enableIndexing = settings.enableIndexing;
    if (settings.rules !== undefined)
      updateData.rules = settings.rules;

    // Build create data object with only non-default values
    const createData: {
      userId: string;
      autoPullRequest?: boolean;
      enableShadowWiki?: boolean;
      memoriesEnabled?: boolean;
      selectedModels?: string[];
      miniModel?: string;
      enableIndexing?: boolean;
      rules?: string;
    } = {
      userId,
    };

    if (
      settings.autoPullRequest !== undefined &&
      settings.autoPullRequest !== false
    )
      createData.autoPullRequest = settings.autoPullRequest;
    if (
      settings.enableShadowWiki !== undefined &&
      settings.enableShadowWiki !== true
    )
      createData.enableShadowWiki = settings.enableShadowWiki;
    if (
      settings.memoriesEnabled !== undefined &&
      settings.memoriesEnabled !== true
    )
      createData.memoriesEnabled = settings.memoriesEnabled;
    if (
      settings.selectedModels !== undefined &&
      settings.selectedModels.length > 0
    )
      createData.selectedModels = settings.selectedModels;
    if (settings.miniModel !== undefined && settings.miniModel !== null)
      createData.miniModel = settings.miniModel;
    if (
      settings.enableIndexing !== undefined &&
      settings.enableIndexing !== false
    )
      createData.enableIndexing = settings.enableIndexing;
    if (settings.rules !== undefined)
      createData.rules = settings.rules;

    const result = await prisma.userSettings.upsert({
      where: { userId },
      update: updateData,
      create: createData,
    });

    return result;
  } catch (error) {
    console.error("Error in updateUserSettings:", error);
    throw error;
  }
}

export async function getOrCreateUserSettings(
  userId: string
): Promise<UserSettings> {
  let settings = await getUserSettings(userId);

  if (!settings) {
    settings = await createUserSettings(userId, {
      autoPullRequest: false,
      enableShadowWiki: false,
      memoriesEnabled: true,
      selectedModels: [],
      enableIndexing: false,
    });
  }

  return settings;
}
