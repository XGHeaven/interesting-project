import dotenv from 'dotenv'
import axios from 'axios'
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
const forceUpdate = process.argv.indexOf('--force') !== -1

const github = new Octokit({
  auth: process.env.GITHUB_TOKEN
})

function renderGithubBadge(address) {
  if (!address) { return '' }
  const info = parse(address)
  const [user, repo] = info.pathname.substr(1).split('/')
  return `[![GitHub stars](https://img.shields.io/github/stars/${user}/${repo}?style=flat-square)](${address})`
}

function renderNpmBadge(name) {
  if (!name) { return '' }
  return `[![npm](https://img.shields.io/npm/v/${name}?style=flat-square)](https://www.npmjs.com/package/${name})`
}

function renderWebsiteBadge(website) {
  if (!website) { return '' }

  return `[![website](https://img.shields.io/badge/website-home-yellowgreen?style=flat-square)](${website})`
}

async function getNpmMetadata(name) {
  const {data} = await axios.get(`https://registry.cnpmjs.org/${name}`)
  return data
}

async function processProject(project) {
  const { updateTime } = project
  if (!updateTime || forceUpdate) {
    const now = Date.now()
    if (!project.createTime) {
      project.createTime = now
    }
    project.updateTime = now

    if (_.has(project, 'desc')) {
      project.description = project.desc
      delete project.desc
    }

    const {npm, name} = project

    if (npm) {
      const packageName = npm === true ? name : npm;
      const pack = await getNpmMetadata(packageName)

      if (!project.description) {
        project.description = pack.description
      }

      if (!project.repo && pack.repository) {
        let repo = pack.repository.url
        repo = repo.replace(/^git\+/, '')
        repo = repo.replace(/\.git$/, '')
        project.repo = repo
      }
    }

    const {repo} = project

    if (repo) {
      const gitUrl = parse(repo)
      const [, githubOwner, githubRepo] = gitUrl.pathname.split('/')
      const {data: info} = await github.repos.get({
        owner: githubOwner,
        repo: githubRepo
      })

      if (!project.description) {
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
        const githubBadge = renderGithubBadge(project.repo)
        const npmBadge = renderNpmBadge(project.npm)
        const websiteBadge = renderWebsiteBadge(project.website)
        return [
          '<details open>',
          `<summary><strong>${project.name}</strong> - ${project.description}</summary>`,
          '',
          `${[githubBadge, npmBadge, websiteBadge].filter(Boolean).join(' ')}`,
          '',
          project.content,
          '</details>',
          ''
        ]
      }),
    ])
  ].flat(Infinity).map(k => k || '').join('\n')
}

async function processDir(source, target) {
  const files = await promises.readdir(source, {withFileTypes: true})
  const tree = [basename(source)]
  for (const file of files) {
    const place = join(source, file.name)
    if (file.isFile() && file.name.endsWith('.toml')) {
      const content = await processToml(place)
      const targetFileName = basename(file.name, '.toml') + '.md'
      await promises.mkdir(target, {recursive: true})
      await promises.writeFile(join(target, targetFileName), content, {encoding: 'utf8'})
      tree.push(targetFileName)
      continue
    }

    if (file.isDirectory()) {
      tree.push(await processDir(place, join(target, file.name)))
    }
  }
  return tree
}

function buildTOC(toc, parentPath = '') {
  const [folder, ...files] = toc
  const currentPath = join(parentPath, folder)

  return [
    `- [${folder}](./${currentPath})`,
    ...files.map(file => {
      if (Array.isArray(file)) {
        return buildTOC(file, currentPath).map(str => `  ${str}`)
      }
      return `  - [${file}](./${join(currentPath, file)})`
    })
  ].flat(Infinity)
}

;(async () => {
  try {
    const toc = await processDir(join(root, 'projects'), join(root, 'docs'))
    // change root name
    toc[0] = 'docs'
    let readme = await promises.readFile(join(root, 'README.md'), {encoding: 'utf8'})
    readme = readme.replace(/<!-- TOC -->[\w\W]*<!-- \/TOC -->/, () => `<!-- TOC -->\n${buildTOC(toc).join('\n')}\n<!-- \/TOC -->`, './')
    await promises.writeFile(join(root, 'README.md'), readme, {encoding: 'utf8'})
    console.log('Updated README.md TOC')
  } catch(e) {
    console.error(e)
  }
})()
