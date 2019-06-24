import dotenv from 'dotenv'
dotenv.config()

import TOML from '@iarna/toml'
import {promises} from 'fs'
import { join, basename, relative, dirname } from 'path'
import { parse } from 'url'
import _ from 'lodash'
import Octokit from '@octokit/rest'

const __dirname = (() => {
  const { pathname } = parse(import.meta.url)
  return join(pathname, '..')
})()
const root = join(__dirname, '..')
const imagePath = join(root, 'images')
const GithubBadge = join(imagePath, 'github.svg')
const NpmBadge = join(imagePath, 'npm.svg')
const WebsiteBadge = join(imagePath, 'website.svg')

const github = new Octokit({
  auth: process.env.GITHUB_TOKEN
})

async function processProject(project) {
  const { updateTime } = project
  if (!updateTime) {
    const now = Date.now()
    if (!project.createTime) {
      project.createTime = now
    }
    project.updateTime = now

    const {repo} = project
    if (repo) {
      const gitUrl = parse(repo)
      const [, githubOwner, githubRepo] = gitUrl.pathname.split('/')
      const {data: info} = await github.repos.get({
        owner: githubOwner,
        repo: githubRepo
      })
      const star = info['stargazers_count']
      if (!_.has(project, 'star')) {
        project.star = star
      }

      if (!_.has(project, 'description')) {
        project.description = info['description']
      }
    }
  }

  return project
}

async function processGroup(group) {
  const projects = await Promise.all((group.projects || []).map(processProject))
  group.projects = projects

  return group
}

async function processToml(filePath) {
  const fileDir = dirname(filePath)
  const fileContent = await promises.readFile(filePath, {encoding: 'utf8'})
  const data = TOML.parse(fileContent)

  const results = [
    `# ${data.title}`,
    data.content,
    '',
  ]

  const groups = await Promise.all((data.groups || []).map(processGroup))
  data.groups = groups
  results.push(groups)

  // rewrite
  await promises.writeFile(filePath, TOML.stringify(data), {encoding: 'utf8'})

  return [
    data.groups.map(group => [
      `### ${group.title}`,
      '',
      group.projects.map(project => {
        const githubBadge = project.repo ? `[![Github](${relative(fileDir, GithubBadge)})](${project.repo})` : ''
        const starBadge = typeof project.star === 'number' ? `⭐️(${project.star})` : ''
        const npmBadge = project.pm ? `[![Npm](${relative(fileDir, NpmBadge)})](${project.pm})` : ''
        const websiteBadge = project.website ? `[![Website](${relative(fileDir, WebsiteBadge)})](${project.website})` : ''
        return [
          `- ${project.name} ${[githubBadge, starBadge, npmBadge, websiteBadge].filter(Boolean).join(' ')} ${project.desc || project.description || ''}`,
          project.content
        ]
      }),
    ])
  ].flat(Infinity).map(k => k || '').join('\n')
}

async function processDir(source, target) {
  const files = await promises.readdir(source, {withFileTypes: true})
  for (const file of files) {
    const place = join(source, file.name)
    if (file.isFile() && file.name.endsWith('.toml')) {
      const content = await processToml(place)
      await promises.mkdir(target, {recursive: true})
      await promises.writeFile(join(target, basename(file.name, '.toml') + '.md'), content, {encoding: 'utf8'})
      continue
    }

    if (file.isDirectory()) {
      await processDir(place, join(target, file.name))
    }
  }
}

;(async () => {
  try {
    await processDir(join(root, 'projects'), join(root, 'docs'))
  } catch(e) {
    console.error(e)
  }
})()
