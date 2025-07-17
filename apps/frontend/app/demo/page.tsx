"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Code2, 
  Terminal, 
  FileText, 
  Play,
  Pause,
  CheckCircle2,
  GitBranch,
  MessageSquare,
  Eye
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function DemoPage() {
  const [activeDemo, setActiveDemo] = useState<string>("overview");

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-6 py-16 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            See Shadow in Action
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            Watch how Shadow transforms natural language instructions into working code
          </p>
        </div>

        <div className="mt-16">
          <Tabs value={activeDemo} onValueChange={setActiveDemo} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="live-coding">Live Coding</TabsTrigger>
              <TabsTrigger value="features">Features</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-8">
              <Card>
                <CardHeader>
                  <CardTitle>Watch Shadow Build a Full-Stack App</CardTitle>
                  <CardDescription>
                    From natural language prompt to deployed application in minutes
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="aspect-video w-full rounded-lg bg-gray-900 flex items-center justify-center">
                    <div className="text-center">
                      <Play className="h-16 w-16 text-gray-500 mx-auto mb-4" />
                      <p className="text-gray-500">Demo video placeholder</p>
                      <p className="text-sm text-gray-600 mt-2">
                        In production, this would show a recorded demo of Shadow building a complete application
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="live-coding" className="mt-8">
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5" />
                      Chat Interface
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="rounded-lg bg-gray-100 p-4">
                        <p className="text-sm font-medium">User</p>
                        <p className="mt-1 text-sm">
                          Create a REST API for a todo app with authentication, CRUD operations, and PostgreSQL database
                        </p>
                      </div>
                      <div className="rounded-lg bg-blue-50 p-4">
                        <p className="text-sm font-medium text-blue-900">Shadow</p>
                        <p className="mt-1 text-sm text-blue-800">
                          I'll create a REST API for your todo app. Let me start by setting up the project structure...
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="h-5 w-5" />
                      Live Terminal
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-lg bg-gray-900 p-4 font-mono text-sm text-green-400">
                      <p>$ npm init -y</p>
                      <p className="text-gray-500">✓ Package.json created</p>
                      <p className="mt-2">$ npm install express jsonwebtoken bcrypt</p>
                      <p className="text-gray-500">✓ Dependencies installed</p>
                      <p className="mt-2">$ npm install -D typescript @types/node</p>
                      <p className="text-gray-500">✓ Dev dependencies installed</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Code Changes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border bg-gray-50 p-4">
                    <pre className="text-sm overflow-x-auto">
                      <code>{`// server.ts
import express from 'express';
import { authRouter } from './routes/auth';
import { todoRouter } from './routes/todos';

const app = express();
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/todos', todoRouter);

app.listen(3000, () => {
  console.log('Server running on port 3000');
});`}</code>
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="features" className="mt-8">
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Interactive Controls</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Play className="h-4 w-4 text-green-600" />
                        <span>Autonomous Mode</span>
                      </div>
                      <Button size="sm" variant="outline">
                        <Pause className="h-4 w-4 mr-2" />
                        Pause
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-blue-600" />
                        <span>Review Changes</span>
                      </div>
                      <Button size="sm" variant="outline">
                        Enable
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-4 w-4 text-purple-600" />
                        <span>Branch: feature/todo-api</span>
                      </div>
                      <Button size="sm" variant="outline">
                        Switch
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Task Progress</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <span className="text-sm">Project initialized</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <span className="text-sm">Dependencies installed</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <span className="text-sm">Database schema created</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
                        <span className="text-sm">Writing API endpoints...</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 rounded-full border-2 border-gray-300" />
                        <span className="text-sm text-gray-500">Running tests</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="mt-16 text-center">
          <h2 className="text-2xl font-bold">Ready to try it yourself?</h2>
          <p className="mt-4 text-lg text-gray-600">
            Start building with Shadow and experience the future of AI-powered development
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/tasks">
              <Button size="lg">
                Start a New Task
                <Code2 className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/demo/terminal">
              <Button size="lg" variant="outline">
                Try Terminal Demo
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}