import Link from "next/link";
import { Button } from "@/components/ui/button";
import { 
  Code2, 
  GitBranch, 
  Terminal, 
  FileText, 
  Users, 
  Zap,
  Bot,
  Eye,
  Download,
  Clock,
  Shield,
  Sparkles
} from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-white">
        <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]"></div>
        
        <div className="relative mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              Shadow
            </h1>
            <p className="mt-6 text-lg leading-8 text-gray-300">
              AI-powered autonomous coding agent that transforms your ideas into production-ready code. 
              Watch as it writes, tests, and deploys your projects in real-time.
            </p>
            <div className="mt-10 flex items-center justify-center gap-x-6">
              <Link href="/tasks">
                <Button size="lg" className="bg-blue-600 hover:bg-blue-700">
                  Get Started
                  <Sparkles className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/demo">
                <Button size="lg" variant="outline" className="text-gray-300 border-gray-700 hover:bg-gray-800">
                  View Demo
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything you need for AI-powered development
            </h2>
            <p className="mt-6 text-lg leading-8 text-gray-600">
              Shadow handles the entire development lifecycle, from code generation to deployment
            </p>
          </div>
          
          <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
            <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-16 lg:max-w-none lg:grid-cols-3">
              <div className="flex flex-col">
                <dt className="flex items-center gap-x-3 text-base font-semibold leading-7">
                  <GitBranch className="h-5 w-5 flex-none text-blue-600" />
                  GitHub Integration
                </dt>
                <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-600">
                  <p className="flex-auto">
                    Connect any GitHub repository and branch. Shadow clones your code and works directly with your project structure.
                  </p>
                </dd>
              </div>
              
              <div className="flex flex-col">
                <dt className="flex items-center gap-x-3 text-base font-semibold leading-7">
                  <Terminal className="h-5 w-5 flex-none text-blue-600" />
                  Live Terminal Stream
                </dt>
                <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-600">
                  <p className="flex-auto">
                    Watch commands execute in real-time. See test results, build outputs, and debugging sessions as they happen.
                  </p>
                </dd>
              </div>
              
              <div className="flex flex-col">
                <dt className="flex items-center gap-x-3 text-base font-semibold leading-7">
                  <FileText className="h-5 w-5 flex-none text-blue-600" />
                  Interactive Code Diffs
                </dt>
                <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-600">
                  <p className="flex-auto">
                    Review every change with inline diffs. Approve, modify, or reject edits before they're applied to your codebase.
                  </p>
                </dd>
              </div>
              
              <div className="flex flex-col">
                <dt className="flex items-center gap-x-3 text-base font-semibold leading-7">
                  <Bot className="h-5 w-5 flex-none text-blue-600" />
                  Multiple AI Models
                </dt>
                <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-600">
                  <p className="flex-auto">
                    Choose from Claude, GPT-4, and other leading models. Each optimized for different types of coding tasks.
                  </p>
                </dd>
              </div>
              
              <div className="flex flex-col">
                <dt className="flex items-center gap-x-3 text-base font-semibold leading-7">
                  <Eye className="h-5 w-5 flex-none text-blue-600" />
                  User-in-the-Loop
                </dt>
                <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-600">
                  <p className="flex-auto">
                    Stay in control with pause/approve modes. Inject commands, guide the agent, or let it run fully autonomous.
                  </p>
                </dd>
              </div>
              
              <div className="flex flex-col">
                <dt className="flex items-center gap-x-3 text-base font-semibold leading-7">
                  <Download className="h-5 w-5 flex-none text-blue-600" />
                  Export & Artifacts
                </dt>
                <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-600">
                  <p className="flex-auto">
                    Download complete codebases, patches, logs, and build artifacts. Everything is persisted for future reference.
                  </p>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-gray-50 py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              How Shadow Works
            </h2>
            <p className="mt-6 text-lg leading-8 text-gray-600">
              Three simple steps to transform your ideas into working code
            </p>
          </div>
          
          <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-4xl">
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-white">
                  <span className="text-2xl font-bold">1</span>
                </div>
                <h3 className="mt-6 text-lg font-semibold">Create a Task</h3>
                <p className="mt-2 text-gray-600">
                  Select your repository, choose an AI model, and describe what you want to build in natural language.
                </p>
              </div>
              
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-white">
                  <span className="text-2xl font-bold">2</span>
                </div>
                <h3 className="mt-6 text-lg font-semibold">Watch & Interact</h3>
                <p className="mt-2 text-gray-600">
                  Shadow analyzes your code, makes intelligent edits, runs tests, and keeps you in the loop throughout.
                </p>
              </div>
              
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-white">
                  <span className="text-2xl font-bold">3</span>
                </div>
                <h3 className="mt-6 text-lg font-semibold">Complete & Deploy</h3>
                <p className="mt-2 text-gray-600">
                  Review the final code, download artifacts, and deploy your fully tested application.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Built with Modern Technology
            </h2>
            <p className="mt-6 text-lg leading-8 text-gray-600">
              Enterprise-grade infrastructure for reliable, scalable AI development
            </p>
          </div>
          
          <div className="mx-auto mt-16 grid max-w-2xl grid-cols-2 gap-8 sm:mt-20 lg:mx-0 lg:max-w-none lg:grid-cols-4">
            <div className="flex flex-col items-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
                <Zap className="h-6 w-6 text-gray-600" />
              </div>
              <h3 className="mt-4 font-semibold">Firecracker VMs</h3>
              <p className="mt-2 text-center text-sm text-gray-600">Secure sandboxed environments</p>
            </div>
            
            <div className="flex flex-col items-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
                <Code2 className="h-6 w-6 text-gray-600" />
              </div>
              <h3 className="mt-4 font-semibold">Kubernetes</h3>
              <p className="mt-2 text-center text-sm text-gray-600">Scalable container orchestration</p>
            </div>
            
            <div className="flex flex-col items-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
                <Shield className="h-6 w-6 text-gray-600" />
              </div>
              <h3 className="mt-4 font-semibold">AWS Infrastructure</h3>
              <p className="mt-2 text-center text-sm text-gray-600">EFS, S3, and RDS storage</p>
            </div>
            
            <div className="flex flex-col items-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
                <Clock className="h-6 w-6 text-gray-600" />
              </div>
              <h3 className="mt-4 font-semibold">Real-time Updates</h3>
              <p className="mt-2 text-center text-sm text-gray-600">WebSocket streaming</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gray-900 py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Ready to accelerate your development?
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-gray-300">
              Join developers who are building faster with AI-powered coding assistance.
            </p>
            <div className="mt-10 flex items-center justify-center gap-x-6">
              <Link href="/tasks">
                <Button size="lg" className="bg-blue-600 hover:bg-blue-700">
                  Start Building
                  <Sparkles className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/auth/login">
                <Button size="lg" variant="outline" className="text-gray-300 border-gray-700 hover:bg-gray-800">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
