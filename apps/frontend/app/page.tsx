import { PromptForm } from "@/components/chat/prompt-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Code, GitBranch, MessageSquare, Monitor, Users, Zap, Shield, Cloud, Terminal } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Hero Section */}
      <section className="relative px-6 pt-16 pb-24">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <div className="flex items-center justify-center mb-6">
              <Image
                src="/shadow.svg"
                alt="Shadow"
                width={48}
                height={48}
                className="mr-3"
              />
              <h1 className="text-5xl font-bold text-white">Shadow</h1>
            </div>
            <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto">
              The autonomous coding platform that transforms natural language instructions into production-ready code. 
              Watch as AI agents edit, test, and deploy your projects in real-time.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
              <Button asChild size="lg" className="bg-blue-600 hover:bg-blue-700 text-white px-8">
                <Link href="#get-started">
                  Get Started <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="border-gray-600 text-gray-300 hover:bg-gray-800">
                <Link href="/demo">
                  View Demo
                </Link>
              </Button>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              <Badge variant="secondary" className="bg-gray-800 text-gray-300">Real-time Collaboration</Badge>
              <Badge variant="secondary" className="bg-gray-800 text-gray-300">Multi-language Support</Badge>
              <Badge variant="secondary" className="bg-gray-800 text-gray-300">Live Code Streaming</Badge>
              <Badge variant="secondary" className="bg-gray-800 text-gray-300">Secure Sandboxes</Badge>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-6 py-20 bg-gray-800/50">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Powerful Features</h2>
            <p className="text-lg text-gray-300 max-w-2xl mx-auto">
              Shadow combines cutting-edge AI with robust infrastructure to deliver an unmatched coding experience
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="bg-gray-900/50 border-gray-700">
              <CardHeader>
                <Code className="h-8 w-8 text-blue-400 mb-2" />
                <CardTitle className="text-white">Live Code Streaming</CardTitle>
                <CardDescription className="text-gray-400">
                  Watch AI agents write, edit, and refactor code in real-time with live diff previews
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="bg-gray-900/50 border-gray-700">
              <CardHeader>
                <Terminal className="h-8 w-8 text-green-400 mb-2" />
                <CardTitle className="text-white">Interactive Terminal</CardTitle>
                <CardDescription className="text-gray-400">
                  See live command execution, test runs, and build processes as they happen
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="bg-gray-900/50 border-gray-700">
              <CardHeader>
                <GitBranch className="h-8 w-8 text-purple-400 mb-2" />
                <CardTitle className="text-white">GitHub Integration</CardTitle>
                <CardDescription className="text-gray-400">
                  Connect any GitHub repository and branch to start coding immediately
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="bg-gray-900/50 border-gray-700">
              <CardHeader>
                <Users className="h-8 w-8 text-orange-400 mb-2" />
                <CardTitle className="text-white">User-in-the-Loop</CardTitle>
                <CardDescription className="text-gray-400">
                  Maintain control with pause/approve modes and manual command injection
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="bg-gray-900/50 border-gray-700">
              <CardHeader>
                <Shield className="h-8 w-8 text-red-400 mb-2" />
                <CardTitle className="text-white">Secure Sandboxes</CardTitle>
                <CardDescription className="text-gray-400">
                  Isolated Firecracker microVMs ensure secure execution environments
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="bg-gray-900/50 border-gray-700">
              <CardHeader>
                <Cloud className="h-8 w-8 text-cyan-400 mb-2" />
                <CardTitle className="text-white">Scalable Infrastructure</CardTitle>
                <CardDescription className="text-gray-400">
                  Kubernetes-powered scaling with persistent storage and artifact management
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">How Shadow Works</h2>
            <p className="text-lg text-gray-300 max-w-2xl mx-auto">
              From idea to implementation in three simple steps
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-white">1</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Submit Your Task</h3>
              <p className="text-gray-300">
                Pick a GitHub repo, select your preferred LLM model, and describe what you want to build in natural language
              </p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-white">2</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Watch & Interact</h3>
              <p className="text-gray-300">
                Monitor live progress as AI agents code, test, and debug. Step in anytime with approvals or manual commands
              </p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-white">3</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Get Results</h3>
              <p className="text-gray-300">
                Download completed code, review audit trails, and deploy with confidence knowing every change was tracked
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section id="get-started" className="px-6 py-20 bg-gray-800/50">
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">Ready to Start Coding?</h2>
            <p className="text-lg text-gray-300 mb-8">
              Transform your ideas into reality with Shadow's autonomous coding platform
            </p>
          </div>
          
          <div className="max-w-2xl mx-auto">
            <PromptForm isHome />
          </div>
          
          <div className="text-center mt-8">
            <p className="text-sm text-gray-400">
              No credit card required • Free to get started • Secure & private
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-12 border-t border-gray-800">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center mb-4 md:mb-0">
              <Image
                src="/shadow.svg"
                alt="Shadow"
                width={24}
                height={24}
                className="mr-2"
              />
              <span className="text-white font-semibold">Shadow</span>
            </div>
            <div className="flex space-x-6 text-sm text-gray-400">
              <Link href="/about" className="hover:text-white transition-colors">About</Link>
              <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
              <Link href="/support" className="hover:text-white transition-colors">Support</Link>
              <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            </div>
          </div>
          <div className="text-center mt-8 pt-8 border-t border-gray-800">
            <p className="text-sm text-gray-400">
              © 2024 Shadow. All rights reserved. Built with Next.js and powered by AI.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
