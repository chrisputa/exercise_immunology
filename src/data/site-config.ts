// import this alway
import type {ImageMetadata} from 'astro:assets'; // always import this

// an image for the course

import {default as courseImg} from '../assets/complexity.png'; 

// image of the instructor
import authorImg from '../assets/dirk.png';

// dark logo, this is auto-generated from ../assets/logo.png, you can replace it with your own dark logo if you want, but make sure to keep the same name and path
import logoDark from '../assets/generated/logo_dark.png';

// light logo
import logoLight from '../assets/logo.png';

// import course config, contains information about the course
import courseConfig from './course-config.json'; 


export type Image = {
    src: ImageMetadata;
    alt?: string;
    caption?: string;
};

export type Author = {
    name: string;
    image?: Image;
    url?: string;
}

export type Link = {
    text: string;
    href: string;
};

export type Hero = {
    title?: string;
    text?: string;
    image?: Image;
    actions?: Link[];
};

export type Subscribe = {
    title?: string;
    text?: string;
    formUrl: string;
};

export type SiteConfig = {
    website: string;
    author: Author;
    logo?: Image;
    title: string;
    subtitle?: string;
    description: string;
    image?: Image;
    headerNavLinks?: Link[];
    footerNavLinks?: Link[];
    socialLinks?: Link[];
    hero?: Hero;
    subscribe?: Subscribe;
    postsPerPage?: number;
    projectsPerPage?: number;
};

const siteConfig: SiteConfig = {
    logo: {
        src: logoLight.src,
        alt: 'TEXT ALTERNATIVE FOR THE LOGO'
    },
    logoDark: {
        src: logoDark.src,
        alt: 'TEXT ALTERNATIVE FOR THE DARK LOGO'
    },
    website: 'https://www.YOUR_WEBSITE.com', // this is the URL of your website, e.g., www.complexity-course.com
    base: '/BASE_FOR_YOUR_SITE/',
    title: 'COURSE TITLE, E.G., QUANTITATIVE ANALYSIS OF COMPLEX SYSTEMS', 
    email: courseConfig.email, // this is read from the course Config file
    author: {
        name: 'NAME OF THE INSTRUCTOR, E.G., DIRK BROCKMANN',
        image: {
            src: authorImg.src,
            alt: 'TEXT ALTERNATIVE FOR THE AUTHOR IMAGE'
        },
        url: 'YOUR MAIN WEBSITE OR SOCIAL MEDIA URL'
    },
    subtitle: 'SUBTITLE',
    description: 'DESCRIPTION OF THE COURSE, E.G., THIS COURSE PROVIDES AN INTRODUCTION TO THE QUANTITATIVE ANALYSIS OF COMPLEX SYSTEMS, FOCUSING ON METHODS AND APPLICATIONS IN NETWORK SCIENCE, DYNAMICAL SYSTEMS, AND DATA ANALYSIS.',
    image: {
        src: courseImg.src,
        alt: 'ALTERNATIVE TEXT FOR THE IMAGE'
    },
    headerNavLinks: [
        {
            text: 'Home',
            href: '/'
        },

        {
            text: 'TL;DR',
            href: '/tldr'
        },
        {
            text: 'Blog',
            href: '/blog'
        },
        {
            text: 'Lectures',
            href: '/lectures'
        },
        {
            text: 'Seminar',
            href: '/seminar'
        },
        {
            text: 'Lab',
            href: '/lab'
        },
        {
            text: 'Tutorials',
            href: '/tutorials'
        },
        {
            text: 'Contact',
            href: '/contact'
        }
    ],
    footerNavLinks: [

        {
            text: 'Contact',
            href: '/contact'
        }, {
            text: 'Terms',
            href: '/terms'
        }
    ],
    socialLinks: [

        {
            text: 'SOCIAL MEDIA OR OTHER LINK, E.G., GITHUB',
            href: 'URL'
        }, {
            text: 'SOCIAL MEDIA OR OTHER LINK, E.G., TWITTER',
            href: 'URL'
        }
    ],


    postsPerPage: 8,
    projectsPerPage: 8
};

export default siteConfig;
