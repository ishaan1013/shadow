import { prisma } from "@repo/db";

export interface UserSettings {
  id: string;
  userId: string;
  autoPullRequest: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
  });

  return settings;
}

export async function createUserSettings(
  userId: string,
  settings: { autoPullRequest: boolean }
): Promise<UserSettings> {
  return await prisma.userSettings.create({
    data: {
      userId,
      autoPullRequest: settings.autoPullRequest,
    },
  });
}

export async function updateUserSettings(
  userId: string,
  settings: { autoPullRequest: boolean }
): Promise<UserSettings> {
  return await prisma.userSettings.upsert({
    where: { userId },
    update: {
      autoPullRequest: settings.autoPullRequest,
    },
    create: {
      userId,
      autoPullRequest: settings.autoPullRequest,
    },
  });
}

export async function getOrCreateUserSettings(userId: string): Promise<UserSettings> {
  let settings = await getUserSettings(userId);
  
  if (!settings) {
    settings = await createUserSettings(userId, { autoPullRequest: true });
  }
  
  return settings;
}